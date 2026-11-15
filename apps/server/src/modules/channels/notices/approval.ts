import {
  approvalViewOf,
  buildOutgoingMessage,
  draftPayloadSchema,
  draftVersion,
  isExternalSender,
  matchSender,
  panelUrlSchema,
  type ApprovalView,
} from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import { getDraft, listSendsToNotify, markNotified, type SendRow } from "../../actions";
import { listSenderRules } from "../../config";
import { getDelegate, listDelegateAddresses } from "../../delegation";
import { getMailbox, isSyntheticMessageId, listMailboxes } from "../../mail";
import { getOrganization, isFeatureOn, listMemberships } from "../../tenancy";
import { type LinkedChat } from "../port";

import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

// The panel page of a send (F102 ticket): `<WEB_BASE_URL>/approvals?id=<send id>`, with no double slash after a trailing `/`.
// A link that the view schema refuses (a space, a line break, too long) is left out: the card must still go out.
export function panelUrlOf(base: string | undefined, sendId: string): string | undefined {
  if (base === undefined) return undefined;
  const url = panelUrlSchema.safeParse(`${base.replace(/\/+$/, "")}/approvals?id=${sendId}`);
  return url.success ? url.data : undefined;
}

// D19: the text the owner sees is the text the committer sends (same builder, same inputs).
// `panelBase`: the base URL of the panel when the link goes on the card (the caller checks the flag `approvals_page`).
export async function approvalViewFor(
  db: DbOrTrx,
  ctx: TenantContext,
  send: SendRow,
  options: { panelBase?: string } = {}
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
  // The edit version of the send (from 2 on the card says so) and the link to the panel.
  view.version = draftVersion(draft);
  const panelUrl = panelUrlOf(options.panelBase, send.id);
  if (panelUrl !== undefined) view.panelUrl = panelUrl;
  return { view, subject: message.subject };
}

// D19: one request per owner for each send that waits, after its draft is applied. No owner: nothing is queued or marked.
async function detectApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  timeZone: string,
  now: Date,
  webBaseUrl: string | undefined
): Promise<void> {
  if (owners.length === 0) return;
  const rows = await listSendsToNotify(db, ctx, { limit: APPROVAL_LIMIT });
  if (rows.length === 0) return;
  // Read once per run. The link goes on the card only when the panel page is on and the base URL is set.
  const panelBase = webBaseUrl !== undefined && (await isFeatureOn(db, ctx, "approvals_page")) ? webBaseUrl : undefined;
  for (const row of rows) {
    try {
      const { view } = await approvalViewFor(db, ctx, row, panelBase === undefined ? {} : { panelBase });
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
  detect: (run) => detectApprovals(run.db, run.ctx, run.owners, run.timeZone, run.now, run.deps.webBaseUrl),
};
