import { buildOutgoingMessage, cleanUserText, EDIT_BODY_MAX, EDIT_SUBJECT_MAX } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { ValidationError } from "../../platform/http";
import { getMailbox, mailboxProfileOf } from "../mail";
import { getOrganization, listMemberships } from "../tenancy";

import { inTransaction } from "./apply-shared";
import type { ApprovalDeps, ApprovalInput } from "./approvals";
import { noLoopHooks } from "./hooks";
import { loopOriginal, mailOriginal } from "./original";
import { replaceApproval } from "./replace";
import type { SendRow } from "./repo";

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

// The original that the text of the send is built from: the mail of a mail send, the loop of a follow-up (`undefined`: the loop
// is gone, so the edit cannot be built).
async function originalOfSend(deps: ApprovalDeps, trx: Transaction<DB>, ctx: TenantContext, send: SendRow) {
  if (send.email !== null) return mailOriginal(send.email);
  if (send.loop_id === null) return undefined;
  const anchor = await (deps.loopHooks ?? noLoopHooks).anchorOf(trx, ctx, send.loop_id);
  return anchor === undefined ? undefined : loopOriginal(anchor);
}

// An edit (supersede) replaces a waiting send by a new version. It checks the texts, then `replaceApproval` does the
// locks, the supersede and the cards (the same core as the redraft of a reply). The owner check is the caller's, as for `approve`.
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

  return inTransaction(deps.db, async (trx): Promise<EditResult> => {
    const result = await replaceApproval(trx, ctx, {
      sendId,
      userId: input.userId,
      via: input.via,
      now: input.now,
      deps,
      payload: async ({ send, kind, draft: oldDraft, draftPayload }) => {
        if (input.delegateId !== undefined && kind !== "delegation") {
          throw new ValidationError([{ path: "delegateId", code: "custom", message: "delegate_not_allowed" }]);
        }
        const currentDelegateId = draftPayload.kind === "delegation" ? draftPayload.delegate_id : undefined;
        let delegate: { id: string; name: string; email: string } | undefined;
        if (input.delegateId !== undefined && input.delegateId !== currentDelegateId) {
          delegate = await deps.hooks.activeDelegate(trx, ctx, input.delegateId);
          if (delegate === undefined) return { refuse: { kind: "delegate_inactive" } };
        }
        if (delegate === undefined) {
          const mailbox = await getMailbox(trx, ctx, send.mailbox_id);
          const organization = await getOrganization(trx, ctx);
          if (mailbox === undefined || organization === undefined) {
            throw new HardError("mailbox or organization not found");
          }
          const owner = (await listMemberships(trx, ctx)).find((member) => member.role === "owner");
          const original = await originalOfSend(deps, trx, ctx, send);
          if (original === undefined) return { refuse: { kind: "closed", state: "loop_closed" } };
          const current = buildOutgoingMessage({
            draft: draftPayload,
            draftActionId: oldDraft.id,
            createdAt: oldDraft.created_at,
            mailbox: { address: mailbox.address },
            owner: { displayName: owner?.display_name ?? mailbox.address },
            organization: { timezone: organization.timezone },
            profile: await mailboxProfileOf(trx, ctx, send.mailbox_id),
            original,
          });
          if (
            subject === cleanUserText(current.subject, { oneLine: true }) &&
            body === cleanUserText(current.parts.body, { oneLine: false })
          ) {
            return { refuse: { kind: "unchanged" } };
          }
        }
        return {
          patch: {
            subject_text: subject,
            body_text: body,
            ...(delegate === undefined
              ? {}
              : { to: [delegate.email], delegate_id: delegate.id, delegate_name: delegate.name }),
          },
        };
      },
    });
    return result.kind === "edited" ? { kind: "edited", sendId: result.sendId, version: result.version } : result;
  });
}
