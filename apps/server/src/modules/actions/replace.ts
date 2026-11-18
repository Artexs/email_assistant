import { draftPayloadSchema, draftVersion, parseToolSwitches, sendPayloadSchema, type DraftPayload } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";

import { anchorOfRow } from "./anchor";
import { decidedBy, loopData, type ApprovalDeps, type ApprovalInput } from "./approvals";
import { STALE_AFTER_MS } from "./constants";
import { closeDraftOfSend } from "./expiry";
import { noLoopHooks } from "./hooks";
import {
  getSend,
  insertEditedPair,
  lockDraft,
  lockSend,
  newestVersionOf,
  setExpired,
  type DraftRow,
  type SendRow,
} from "./repo";

// The send, the draft and the draft payload that the replace holds under lock. A `payload` function reads them to build the patch
// (the edit compares the new text with the message that the old version would send).
export interface LockedPair {
  send: SendRow;
  kind: DraftPayload["kind"];
  draft: DraftRow;
  draftPayload: DraftPayload;
}

// A patch that the caller refuses instead of making: the replace writes nothing and answers with this result.
export type ReplaceRefusal = { kind: "unchanged" | "delegate_inactive" } | { kind: "closed"; state: string };

export type ReplaceResult =
  | { kind: "edited"; sendId: string; draftId: string; version: number }
  | { kind: "changed"; currentId: string }
  | { kind: "closed"; state: string }
  | { kind: "not_editable" | "drafts_off" | "not_found" }
  | ReplaceRefusal;

// `payload` is a patch of the DRAFT payload: its keys replace the keys of the old draft in the new version (`undefined` drops a
// key). `version`, the recipients of the send and the delegate follow it: the new send takes `to`, `cc` and `delegate_id` from the
// patch when the patch names them, so a draft and its send never differ (the committer refuses a pair that differs).
// A function builds the patch from the locked rows, or answers a refusal.
export type ReplacePayload =
  | Record<string, unknown>
  | ((locked: LockedPair) => Promise<{ patch: Record<string, unknown> } | { refuse: ReplaceRefusal }>);

export type ReplaceDeps = Pick<ApprovalDeps, "hooks" | "approvalHooks" | "loopHooks" | "uidplus">;

const SAVEPOINT = "approval_edit";

// The supersede core of an edit (the first version of it lived in `editApproval`): a waiting send and its draft are replaced by a
// new version in one transaction, with no call to the outside. `editApproval` calls it with a new text or delegate; the redraft,
// "Reply all" and "Use Reply-To" of the reply drafts call it with a new body or new recipients.
// Lock order: the mailbox settings row (share, the first statement, as the chaser and `saveTriage` do it), the loop of a follow-up,
// the old send, its draft, the delegation. A setter (shadow mode, `create_draft` off, the reply switch off) takes the settings row
// FOR UPDATE and then closes the waiting sends, so it waits for this transaction, or this one sees its commit and answers `drafts_off`.
// The old send ends `expired` / `superseded` exactly once (the `awaiting_approval` guard of `setExpired`), and nothing sends the
// old text: the committer sends only an `approved` send, and the new one is `awaiting_approval`.
// The owner check is the caller's, as for `approve`.
export async function replaceApproval(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: ApprovalInput & { sendId: string; payload: ReplacePayload; deps: ReplaceDeps }
): Promise<ReplaceResult> {
  const { deps, sendId } = input;
  // An unlocked read finds the mailbox that the settings lock needs; the locked read below decides.
  const probe = await getSend(trx, ctx, sendId);
  if (probe === undefined) return { kind: "not_found" };
  const mailboxId = probe.mailbox_id;

  if ((await lockSettingsForShare(trx, ctx, mailboxId)) === undefined) return { kind: "drafts_off" };
  // The share lock is held: a setter cannot commit between this read and the end of the transaction.
  const settings = await getMailboxSettings(trx, ctx, mailboxId);
  const switches = settings && parseToolSwitches(settings.tool_switches);
  // The gate of a reply draft is its own switch (reply drafts), the gate of every other kind is `create_draft`. The kind is read
  // from the unlocked probe: a send never changes its kind, and the settings lock above is the one that decides.
  const probeKind = sendPayloadSchema.safeParse(probe.payload);
  const gateOn = probeKind.success && probeKind.data.kind === "reply" ? switches?.reply_drafts : switches?.create_draft;
  if (!settings || !switches || settings.mode !== "assist" || !gateOn) return { kind: "drafts_off" };

  // Lock order for a follow-up: its loop first, then the send. A closed loop refuses the replace (after the checks below, so
  // an old version still answers `changed` and a closed send still names its state).
  const loopOpen = probe.loop_id === null || (await (deps.loopHooks ?? noLoopHooks).isOpen(trx, ctx, probe.loop_id));
  const send = await lockSend(trx, ctx, sendId);
  if (send === undefined) return { kind: "not_found" };
  if (send.status === "expired" && send.status_reason === "superseded") {
    return { kind: "changed", currentId: await newestVersionOf(trx, ctx, sendId) };
  }
  if (send.status !== "awaiting_approval") return { kind: "closed", state: send.status };
  if (!loopOpen) return { kind: "closed", state: "loop_closed" };
  const sendPayload = sendPayloadSchema.safeParse(send.payload);
  if (!sendPayload.success) return { kind: "closed", state: "payload_gone" };
  const kind = sendPayload.data.kind;
  if (kind === "reminder") return { kind: "not_editable" };

  const oldDraft =
    send.depends_on_action_id === null ? undefined : await lockDraft(trx, ctx, send.depends_on_action_id);
  const draft = oldDraft && draftPayloadSchema.safeParse(oldDraft.payload);
  if (oldDraft === undefined || !draft?.success) return { kind: "closed", state: "draft_gone" };

  const built =
    typeof input.payload === "function"
      ? await input.payload({ send, kind, draft: oldDraft, draftPayload: draft.data })
      : { patch: input.payload };
  if ("refuse" in built) return built.refuse;
  const { patch } = built;

  const currentDelegateId = draft.data.kind === "delegation" ? draft.data.delegate_id : undefined;
  const version = draftVersion(draft.data) + 1;
  // The raw payloads are the base: the schema strips keys that it does not know (`delegation_id` of a delegation draft).
  const newDraftPayload: Record<string, unknown> = { ...oldDraft.payload, ...patch, version };
  const draftCheck = draftPayloadSchema.safeParse(newDraftPayload);
  if (!draftCheck.success) throw new HardError("replaced draft payload is invalid");
  const newSendPayload: Record<string, unknown> = { ...send.payload };
  for (const key of ["to", "cc", "delegate_id"] as const) {
    if (key in patch) newSendPayload[key] = patch[key];
  }
  if (!sendPayloadSchema.safeParse(newSendPayload).success) throw new HardError("replaced send payload is invalid");
  const delegateChanged = typeof patch.delegate_id === "string" && patch.delegate_id !== currentDelegateId;

  // The delegation hook answers false when the delegation is not `drafted`: the savepoint undoes the writes below.
  await sql`savepoint ${sql.id(SAVEPOINT)}`.execute(trx);
  const created = await insertEditedPair(trx, ctx, {
    anchor: anchorOfRow(send),
    oldDraftId: oldDraft.id,
    oldSendId: send.id,
    draftPayload: newDraftPayload,
    sendPayload: newSendPayload,
  });
  if (created === null) throw new HardError("the edit rows of a waiting send exist");
  const changed = await setExpired(trx, ctx, send.id, {
    reason: "superseded",
    at: input.now,
    from: "awaiting_approval",
    staleBefore: new Date(input.now.getTime() - STALE_AFTER_MS),
    resultNotifiedAt: input.now,
  });
  if (!changed) throw new HardError("a locked awaiting_approval send did not change");
  await recordAudit(trx, ctx, {
    emailId: send.email_id,
    actionId: send.id,
    actor: input.userId,
    event: auditEvents.actionExpired,
    reasonCode: "superseded",
    data: { action_type: "send", reason: "superseded", ...loopData(send) },
    at: input.now,
  });
  // `ready` -> expired; `applied` + UIDPLUS -> a reverse row that deletes the copy; `applying` -> the APPEND path closes it;
  // without UIDPLUS the old copy stays in Drafts, as after a reject. The reason stays `expired`: the reverse payload, `markUndone` and the `undone` edge take no new value.
  await closeDraftOfSend(trx, ctx, oldDraft.id, {
    reason: "expired",
    now: input.now,
    uidplus: await deps.uidplus(ctx, mailboxId),
  });
  const delegationId = send.payload.delegation_id;
  if (kind === "delegation" && typeof delegationId === "string") {
    const moved = await deps.hooks.onSuperseded(trx, ctx, {
      delegationId,
      draftActionId: created.draftId,
      sendActionId: created.sendId,
      delegateId: typeof patch.delegate_id === "string" ? patch.delegate_id : (currentDelegateId ?? ""),
      at: input.now,
    });
    if (!moved) {
      await sql`rollback to savepoint ${sql.id(SAVEPOINT)}`.execute(trx);
      return { kind: "closed", state: "delegation_closed" };
    }
  }
  // The cards of the old send show "changed" (the new version gets its own card from the notifier).
  await deps.approvalHooks.onDecided(trx, ctx, {
    sendId: send.id,
    decision: "changed",
    ...decidedBy(input),
    at: input.now,
  });
  await recordAudit(trx, ctx, {
    emailId: send.email_id,
    actionId: created.sendId,
    actor: input.userId,
    event: auditEvents.actionEdited,
    data: {
      previous_action_id: send.id,
      version,
      delegate_changed: delegateChanged,
      via: input.via,
      ...loopData(send),
    },
    at: input.now,
  });
  return { kind: "edited", sendId: created.sendId, draftId: created.draftId, version };
}
