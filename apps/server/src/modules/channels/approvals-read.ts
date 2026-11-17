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
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import {
  APPROVAL_TTL_MS,
  getDraft,
  getSend,
  listApprovalSends,
  newestVersionOf,
  STALE_AFTER_MS,
  UNNOTIFIED_TTL_MS,
  type DraftRow,
  type SendRow,
  type SendScope,
} from "../actions";
import { listDelegates } from "../delegation";
import { getMailbox, mailboxHasUidplus } from "../mail";

import { heldReason } from "./held-reason";
import { approvalViewFor } from "./notices/approval";

// F102 ticket: the read side of the approvals page. It builds the view with `approvalViewFor`, the builder of the card,
// so the page shows the text that the committer sends. Every read filters by the organization (`ctx`).

export interface ApprovalReadDeps {
  db: Db;
  sendScope: SendScope;
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

// `waiting` from the link to Telegram (`notified_at`), else from the plan time; `held` from the tap.
export function expiresAtOf(send: SendRow, state: DetailState): Date | null {
  if (state === "waiting") {
    return send.notified_at === null
      ? new Date(send.created_at.getTime() + UNNOTIFIED_TTL_MS)
      : new Date(send.notified_at.getTime() + APPROVAL_TTL_MS);
  }
  if (state === "held") return new Date((send.approved_at ?? send.created_at).getTime() + APPROVAL_TTL_MS);
  return null;
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
  const items: ApprovalItem[] = [];
  for (const send of sends) {
    const b = await build(deps, ctx, send, now);
    const expiresAt = b === undefined ? null : expiresAtOf(send, b.state);
    if (b === undefined || b.view === null || b.payload === undefined || expiresAt === null) continue;
    if (b.state !== "waiting" && b.state !== "held") continue;
    items.push({
      ...common(b),
      state: b.state,
      version: b.view.version ?? 1,
      kind: b.payload.kind,
      expiresAt: expiresAt.toISOString(),
      view: b.view,
    });
  }
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
  return approvalDetailSchema.parse({
    ...common(b),
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
