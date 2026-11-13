import {
  approvalViewOf,
  buildOutgoingMessage,
  draftPayloadSchema,
  isExternalSender,
  matchSender,
  type ApprovalView,
} from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import { getDraft, listSendsToNotify, markNotified, type SendRow } from "../../actions";
import { listSenderRules } from "../../config";
import { getDelegate, listDelegateAddresses } from "../../delegation";
import { getMailbox, isSyntheticMessageId, listMailboxes } from "../../mail";
import { getOrganization, listMemberships } from "../../tenancy";
import { type LinkedChat } from "../port";

import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

// D19: the text the owner sees is the text the committer sends (same builder, same inputs).
export async function approvalViewFor(
  db: DbOrTrx,
  ctx: TenantContext,
  send: SendRow
): Promise<{ view: ApprovalView; subject: string }> {
  if (send.depends_on_action_id === null) throw new Error("send has no draft");
  const draftRow = await getDraft(db, ctx, send.depends_on_action_id);
  if (draftRow === undefined) throw new Error("draft not found");
  const draft = draftPayloadSchema.parse(draftRow.payload);
  const mailbox = await getMailbox(db, ctx, send.email.mailbox_id);
  if (mailbox === undefined) throw new Error("mailbox not found");
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const owner = (await listMemberships(db, ctx)).find((member) => member.role === "owner");
  const { email } = send;
  const original = {
    fromAddress: email.from_address,
    subject: email.subject,
    receivedAt: email.received_at,
    messageId: email.message_id_header,
    inReplyTo: email.in_reply_to,
    references: email.references_header?.split(/\s+/).filter((id) => id !== "") ?? [],
    bodyText: email.body_text,
  };
  const message = buildOutgoingMessage({
    draft,
    draftActionId: draftRow.id,
    createdAt: draftRow.created_at,
    mailbox: { address: mailbox.address },
    owner: { displayName: owner?.display_name ?? mailbox.address },
    organization: { styleText: organization.style_text, timezone: organization.timezone },
    original,
  });
  const match = matchSender(email.from_address, await listSenderRules(db, ctx, mailbox.id));
  const internalAddresses = [
    ...(await listMailboxes(db, ctx)).map((box) => box.address),
    ...(await listDelegateAddresses(db, ctx, { activeOnly: true })),
  ];
  const external = isExternalSender(email.from_address, {
    internalAddresses,
    whitelisted: match.whitelisted,
    vip: match.vip,
  });
  const delegate = "delegate_id" in draft ? await getDelegate(db, ctx, draft.delegate_id) : undefined;
  const view = approvalViewOf(message, {
    draft,
    original,
    external,
    synthetic: isSyntheticMessageId(email.message_id_header),
    recipientInactive: delegate !== undefined && !delegate.active,
  });
  return { view, subject: message.subject };
}

// D19: one request per owner for each send that waits, after its draft is applied. No owner: nothing is queued or marked.
async function detectApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  timeZone: string,
  now: Date
): Promise<void> {
  if (owners.length === 0) return;
  for (const row of await listSendsToNotify(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      const { view } = await approvalViewFor(db, ctx, row);
      const noticeView = { actionId: row.id, view, now, timeZone };
      await inTransaction(db, async (trx) => {
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              locale: owner.locale,
              kind: "approval",
              dedupKey: `approval:${row.id}`,
              emailId: row.email_id,
              view: noticeView,
            },
            now
          );
        }
        await markNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      warnSkipped("approval", row.id, error);
    }
  }
}

export const approvalDetector: Detector = {
  name: "approval",
  kinds: ["approval"],
  detect: (run) => detectApprovals(run.db, run.ctx, run.owners, run.timeZone, run.now),
};
