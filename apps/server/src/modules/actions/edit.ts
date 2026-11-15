import {
  buildOutgoingMessage,
  cleanUserText,
  draftPayloadSchema,
  draftVersion,
  EDIT_BODY_MAX,
  EDIT_SUBJECT_MAX,
  parseToolSwitches,
  sendPayloadSchema,
} from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { ValidationError } from "../../platform/http";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";
import { getMailbox } from "../mail";
import { getOrganization, listMemberships } from "../tenancy";

import { anchorOfRow } from "./anchor";
import { inTransaction } from "./apply-shared";
import { decidedBy, loopData, type ApprovalDeps, type ApprovalInput } from "./approvals";
import { STALE_AFTER_MS } from "./constants";
import { closeDraftOfSend } from "./expiry";
import { noLoopHooks } from "./hooks";
import { loopOriginal, mailOriginal } from "./original";
import { getSend, insertEditedPair, lockDraft, lockSend, newestVersionOf, setExpired, type SendRow } from "./repo";

export interface EditInput extends ApprovalInput {
  subject: string;
  body: string;
  // Only for the kind `delegation`. The delegate must be active; the current one means "no change".
  delegateId?: string;
}

export type EditResult =
  | { kind: "edited"; sendId: string; version: number }
  | { kind: "changed"; currentId: string }
  | { kind: "closed"; state: string }
  | { kind: "not_editable" | "unchanged" | "delegate_inactive" | "drafts_off" | "not_found" };

function textError(path: "subject" | "body", message: string): ValidationError {
  return new ValidationError([{ path, code: "custom", message }]);
}

const SAVEPOINT = "approval_edit";

// The original that the text of the send is built from: the mail of a mail send, the loop of a follow-up (`undefined`: the loop
// is gone, so the edit cannot be built).
async function originalOfSend(deps: ApprovalDeps, trx: Transaction<DB>, ctx: TenantContext, send: SendRow) {
  if (send.email !== null) return mailOriginal(send.email);
  if (send.loop_id === null) return undefined;
  const anchor = await (deps.loopHooks ?? noLoopHooks).anchorOf(trx, ctx, send.loop_id);
  return anchor === undefined ? undefined : loopOriginal(anchor);
}

// An edit (F102 ticket, supersede) replaces a waiting send by a new version in one transaction, with no call to the outside.
// Lock order: the mailbox settings row (share, the first statement, as the chaser and `saveTriage` do it), the old send,
// its draft, the delegation. A setter (shadow mode, `create_draft` off) takes the settings row FOR UPDATE and then closes
// the waiting sends, so it waits for this transaction, or this one sees its commit and answers `drafts_off`.
// The old send ends `expired` / `superseded` exactly once (the `awaiting_approval` guard of `setExpired`), and nothing
// sends the old text: the committer sends only an `approved` send, and the new one is `awaiting_approval`.
// The owner check is the caller's, as for `approve`.
export async function editApproval(
  deps: ApprovalDeps,
  ctx: TenantContext,
  sendId: string,
  input: EditInput
): Promise<EditResult> {
  const subject = cleanUserText(input.subject, { oneLine: true });
  const body = cleanUserText(input.body, { oneLine: false });
  if (subject.length < 1 || subject.length > EDIT_SUBJECT_MAX) throw textError("subject", "subject_length");
  if (body.length < 1 || body.length > EDIT_BODY_MAX) throw textError("body", "body_length");

  // An unlocked read finds the mailbox that the settings lock needs; the locked read below decides.
  const probe = await getSend(deps.db, ctx, sendId);
  if (probe === undefined) return { kind: "not_found" };
  const mailboxId = probe.mailbox_id;

  return inTransaction(deps.db, async (trx): Promise<EditResult> => {
    if ((await lockSettingsForShare(trx, ctx, mailboxId)) === undefined) return { kind: "drafts_off" };
    // The share lock is held: a setter cannot commit between this read and the end of the transaction.
    const settings = await getMailboxSettings(trx, ctx, mailboxId);
    const switches = settings && parseToolSwitches(settings.tool_switches);
    if (!settings || !switches || settings.mode !== "assist" || !switches.create_draft) return { kind: "drafts_off" };

    // Lock order for a follow-up: its loop first, then the send. A closed loop refuses the edit (after the checks below, so
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
    if (input.delegateId !== undefined && kind !== "delegation") {
      throw new ValidationError([{ path: "delegateId", code: "custom", message: "delegate_not_allowed" }]);
    }

    const oldDraft =
      send.depends_on_action_id === null ? undefined : await lockDraft(trx, ctx, send.depends_on_action_id);
    const draft = oldDraft && draftPayloadSchema.safeParse(oldDraft.payload);
    if (oldDraft === undefined || !draft?.success) return { kind: "closed", state: "draft_gone" };

    const currentDelegateId = draft.data.kind === "delegation" ? draft.data.delegate_id : undefined;
    let delegate: { id: string; name: string; email: string } | undefined;
    if (input.delegateId !== undefined && input.delegateId !== currentDelegateId) {
      delegate = await deps.hooks.activeDelegate(trx, ctx, input.delegateId);
      if (delegate === undefined) return { kind: "delegate_inactive" };
    }

    if (delegate === undefined) {
      const mailbox = await getMailbox(trx, ctx, mailboxId);
      const organization = await getOrganization(trx, ctx);
      if (mailbox === undefined || organization === undefined) throw new HardError("mailbox or organization not found");
      const owner = (await listMemberships(trx, ctx)).find((member) => member.role === "owner");
      const original = await originalOfSend(deps, trx, ctx, send);
      if (original === undefined) return { kind: "closed", state: "loop_closed" };
      const current = buildOutgoingMessage({
        draft: draft.data,
        draftActionId: oldDraft.id,
        createdAt: oldDraft.created_at,
        mailbox: { address: mailbox.address },
        owner: { displayName: owner?.display_name ?? mailbox.address },
        organization: { styleText: organization.style_text, timezone: organization.timezone },
        original,
      });
      if (
        subject === cleanUserText(current.subject, { oneLine: true }) &&
        body === cleanUserText(current.parts.body, { oneLine: false })
      ) {
        return { kind: "unchanged" };
      }
    }

    const version = draftVersion(draft.data) + 1;
    // The raw payloads are the base: the schema strips keys that it does not know (`delegation_id` of a delegation draft).
    const newDraftPayload = {
      ...oldDraft.payload,
      version,
      subject_text: subject,
      body_text: body,
      ...(delegate === undefined
        ? {}
        : { to: [delegate.email], delegate_id: delegate.id, delegate_name: delegate.name }),
    };
    if (!draftPayloadSchema.safeParse(newDraftPayload).success) throw new HardError("edited draft payload is invalid");
    const newSendPayload = {
      ...send.payload,
      ...(delegate === undefined ? {} : { to: [delegate.email], delegate_id: delegate.id }),
    };

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
        delegateId: delegate?.id ?? currentDelegateId ?? "",
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
        delegate_changed: delegate !== undefined,
        via: input.via,
        ...loopData(send),
      },
      at: input.now,
    });
    return { kind: "edited", sendId: created.sendId, version };
  });
}
