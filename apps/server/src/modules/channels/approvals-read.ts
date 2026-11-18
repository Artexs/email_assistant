import {
  APPROVAL_LIST_MAX,
  approvalDetailSchema,
  approvalListSchema,
  draftPayloadSchema,
  sendPayloadSchema,
  type ApprovalDetail,
  type ApprovalItem,
  type ApprovalList,
  type SendPayload,
  type SenderLine,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import {
  approvalExpiresAt,
  getDraft,
  getSend,
  listApprovalSends,
  newestVersionOf,
  sendKindOf,
  STALE_AFTER_MS,
  type DraftRow,
  type SendRow,
  type SendScope,
} from "../actions";
import { readSenderLines, type SenderLineDeps, type SenderMail } from "../contacts";
import { listDelegates } from "../delegation";
import { getMailbox, mailboxHasUidplus } from "../mail";

import { heldReason } from "./held-reason";
import { approvalViewFor } from "./notices/approval";

// The read side of the approvals page. It builds the view with `approvalViewFor`, the builder of the card,
// so the page shows the text that the committer sends. Every read filters by the organization (`ctx`).

export interface ApprovalReadDeps {
  db: Db;
  sendScope: SendScope;
  // The sender line (flag `sender_context`). Absent: no line, as with the flag off.
  sender?: SenderLineDeps;
}

type DetailState = ApprovalDetail["state"];

// A send in `approved` that a run holds is in flight (`sending`); one that no run holds waits (`held`). The same
// rule as `setRejected`.
export function stateOf(send: SendRow, now: Date): DetailState | undefined {
  switch (send.status) {
    case "awaiting_approval":
      return "waiting";
    case "approved":
      return send.locked_at !== null && send.locked_at.getTime() >= now.getTime() - STALE_AFTER_MS ? "sending" : "held";
    case "applying":
      return "sending";
    case "applied":
      return "sent";
    case "rejected":
    case "failed":
      return send.status;
    case "expired":
      return send.status_reason === "superseded" ? "superseded" : "expired";
    default:
      return undefined; // not a state of a send
  }
}

// The end of the approval: `approvalExpiresAt` is the one rule (a reply 7 days after it was made, another kind 48 h after the owner
// was told or 7 days after it was planned, a held send 48 h after the tap).
export function expiresAtOf(send: SendRow, state: DetailState): Date | null {
  if (state !== "waiting" && state !== "held") return null;
  return approvalExpiresAt(sendKindOf(send.payload), send);
}

interface Built {
  send: SendRow;
  state: DetailState;
  payload: SendPayload | undefined; // undefined: retention cleared the payload of the send
  draft: DraftRow | undefined;
  mailboxAddress: string;
  view: ApprovalItem["view"] | null; // null: the payload of the send or of its draft is gone
  quote: string | null;
  version: number | null;
  heldBy: ApprovalItem["heldBy"];
}

async function build(deps: ApprovalReadDeps, ctx: TenantContext, send: SendRow, now: Date): Promise<Built | undefined> {
  const state = stateOf(send, now);
  if (state === undefined) return undefined;
  const mailbox = await getMailbox(deps.db, ctx, send.mailbox_id);
  if (mailbox === undefined) return undefined;
  const payload = sendPayloadSchema.safeParse(send.payload);
  const draft =
    send.depends_on_action_id === null ? undefined : await getDraft(deps.db, ctx, send.depends_on_action_id);
  const draftOk = draft !== undefined && draftPayloadSchema.safeParse(draft.payload).success;
  const built = payload.success && draftOk ? await approvalViewFor(deps.db, ctx, send, { draftRow: draft }) : undefined;
  const heldBy = state === "held" ? ((await heldReason(deps, ctx, send.id)) ?? null) : null;
  return {
    send,
    state,
    payload: payload.success ? payload.data : undefined,
    draft,
    mailboxAddress: mailbox.address,
    view: built?.view ?? null,
    quote: built?.quote ?? null,
    version: built?.view.version ?? null,
    heldBy,
  };
}

// The mail that the sender line is about: the original mail of the send. A follow-up or a reminder has none, and the address is null once
// retention cleared it.
function senderMailOf(b: Built): SenderMail {
  return { mailboxId: b.send.mailbox_id, address: b.send.email?.from_address ?? null };
}

// The `sender` key of each build, in order: `{}` while the flag is off (the key is absent), else `{ sender: line | null }`.
async function senderKeys(
  deps: ApprovalReadDeps,
  ctx: TenantContext,
  builds: readonly Built[],
  now: Date
): Promise<{ sender?: SenderLine | null }[]> {
  const lines =
    deps.sender === undefined ? null : await readSenderLines(deps.sender, ctx, builds.map(senderMailOf), now);
  return builds.map((_, index) => (lines === null ? {} : { sender: lines[index] ?? null }));
}

function common(b: Built) {
  return {
    id: b.send.id,
    mailboxAddress: b.mailboxAddress,
    createdAt: b.send.created_at.toISOString(),
    delegationId: b.payload?.delegation_id ?? null,
    setId: b.payload?.set_id ?? null,
    ...(b.send.loop_id === null ? {} : { loopId: b.send.loop_id }),
    draftReady: b.draft?.status === "applied",
    heldBy: b.heldBy,
  };
}

// The waiting and the held sends, newest first, at most 100. A send whose payload retention cleared is left out.
export async function listApprovals(deps: ApprovalReadDeps, ctx: TenantContext, now: Date): Promise<ApprovalList> {
  const sends = await listApprovalSends(deps.db, ctx, {
    staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
    limit: APPROVAL_LIST_MAX,
  });
  const kept: {
    b: Built;
    state: ApprovalItem["state"];
    expiresAt: Date;
    view: NonNullable<Built["view"]>;
    payload: SendPayload;
  }[] = [];
  for (const send of sends) {
    const b = await build(deps, ctx, send, now);
    const expiresAt = b === undefined ? null : expiresAtOf(send, b.state);
    if (b === undefined || b.view === null || b.payload === undefined || expiresAt === null) continue;
    if (b.state !== "waiting" && b.state !== "held") continue;
    kept.push({ b, state: b.state, expiresAt, view: b.view, payload: b.payload });
  }
  // One profile read for the whole list.
  const senders = await senderKeys(
    deps,
    ctx,
    kept.map((entry) => entry.b),
    now
  );
  const items: ApprovalItem[] = kept.map(({ b, state, expiresAt, view, payload }, index) => ({
    ...common(b),
    ...senders[index],
    state,
    version: view.version ?? 1,
    kind: payload.kind,
    expiresAt: expiresAt.toISOString(),
    view,
  }));
  return approvalListSchema.parse({ items });
}

// Any send of the organization. A `create_draft` id, another action type or another organization's id: undefined (404).
export async function getApprovalDetail(
  deps: ApprovalReadDeps,
  ctx: TenantContext,
  id: string,
  now: Date
): Promise<ApprovalDetail | undefined> {
  const send = await getSend(deps.db, ctx, id);
  if (send === undefined) return undefined;
  const b = await build(deps, ctx, send, now);
  if (b === undefined) return undefined;
  const delegates =
    b.payload?.kind === "delegation"
      ? (await listDelegates(deps.db, ctx, { activeOnly: true })).map(({ id: delegateId, name, email }) => ({
          id: delegateId,
          name,
          email,
        }))
      : [];
  const [sender] = await senderKeys(deps, ctx, [b], now);
  return approvalDetailSchema.parse({
    ...common(b),
    ...sender,
    version: b.version,
    state: b.state,
    kind: b.payload?.kind ?? null,
    expiresAt: expiresAtOf(send, b.state)?.toISOString() ?? null,
    view: b.view,
    draftRemovable: await mailboxHasUidplus(deps.db, ctx, send.mailbox_id),
    currentId: b.state === "superseded" ? await newestVersionOf(deps.db, ctx, send.id) : null,
    quote: b.quote,
    delegates,
  });
}
