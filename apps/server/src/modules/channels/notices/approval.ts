import {
  approvalViewOf,
  buildOutgoingMessage,
  draftPayloadSchema,
  draftVersion,
  isExternalSender,
  matchSender,
  NoticeViewError,
  otherParticipants,
  otherReplyTo,
  panelUrlSchema,
  REPLY_CC_MAX,
  type ApprovalView,
  type OriginalMail,
} from "@ea/core";

import { type TenantContext } from "../../../platform/db";
import {
  getDraft,
  listSendsToNotify,
  loopOriginal,
  mailOriginal,
  markNotified,
  type DraftRow,
  type LoopHooks,
  type SendRow,
} from "../../actions";
import { listSenderRules } from "../../config";
import { getDelegate, listDelegateAddresses } from "../../delegation";
import { loopHooks } from "../../loops";
import {
  getMailbox,
  isSentVisible,
  isSyntheticMessageId,
  listMailboxes,
  mailboxProfileOf,
  replyFactsOf,
} from "../../mail";
import { getOrganization, isFeatureOn, listMemberships } from "../../tenancy";
import { type NoticeRecipient } from "../notice-fan-out";

import { queueLoopConsentLines, splitByLoopConsent, type LoopGate } from "./loop-consent";
import { APPROVAL_LIMIT, DbOrTrx, inTransaction, queue, warnSkipped, type Detector } from "./run";

// The panel page of a send: `<WEB_BASE_URL>/approvals?id=<send id>`, with no double slash after a trailing `/`.
// A link that the view schema refuses (a space, a line break, too long) is left out: the card must still go out.
export function panelUrlOf(base: string | undefined, sendId: string): string | undefined {
  if (base === undefined) return undefined;
  const url = panelUrlSchema.safeParse(`${base.replace(/\/+$/, "")}/approvals?id=${sendId}`);
  return url.success ? url.data : undefined;
}

// The list page of the panel (`<WEB_BASE_URL>/approvals`): the link of the one line that an owner without loop consent gets.
export function panelListUrlOf(base: string | undefined): string | undefined {
  if (base === undefined) return undefined;
  const url = panelUrlSchema.safeParse(`${base.replace(/\/+$/, "")}/approvals`);
  return url.success ? url.data : undefined;
}

// The text the owner sees is the text the committer sends (same builder, same inputs).
// `panelBase`: the base URL of the panel when the link goes on the card (the caller checks the flag `approvals_page`).
// `draftRow`: the draft of the send when the caller has read it. `quote` is the whole quote that the committer sends
// (up to 8000 characters); the view holds the quote cut for a card. `replyAllAdds` (a reply only, when Reply all is offered): the
// addresses that Reply all would add to Cc, so the panel shows them before the tap; the card shows no list and does not carry them.
export async function approvalViewFor(
  db: DbOrTrx,
  ctx: TenantContext,
  send: SendRow,
  options: { panelBase?: string; draftRow?: DraftRow; loopHooks?: LoopHooks } = {}
): Promise<{ view: ApprovalView; subject: string; quote: string | null; replyAllAdds?: string[] }> {
  if (send.depends_on_action_id === null) throw new Error("send has no draft");
  const draftRow = options.draftRow ?? (await getDraft(db, ctx, send.depends_on_action_id));
  if (draftRow === undefined) throw new Error("draft not found");
  const draft = draftPayloadSchema.parse(draftRow.payload);
  const mailbox = await getMailbox(db, ctx, send.mailbox_id);
  if (mailbox === undefined) throw new Error("mailbox not found");
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const owner = (await listMemberships(db, ctx)).find((member) => member.role === "owner");
  // A follow-up is built from its loop, any other kind from its mail: the draft kind and the anchor must agree.
  const { email } = send;
  let original: OriginalMail;
  if (draft.kind === "follow_up") {
    if (email !== null || send.loop_id === null || draft.loop_id !== send.loop_id) throw new Error("follow-up anchor");
    const anchor = await (options.loopHooks ?? loopHooks()).anchorOf(db, ctx, send.loop_id);
    if (anchor === undefined) throw new Error("loop not found");
    original = loopOriginal(anchor);
  } else {
    if (email === null) throw new Error("draft kind needs a mail");
    original = mailOriginal(email);
  }
  const message = buildOutgoingMessage({
    draft,
    draftActionId: draftRow.id,
    createdAt: draftRow.created_at,
    mailbox: { address: mailbox.address },
    owner: { displayName: owner?.display_name ?? mailbox.address },
    organization: { timezone: organization.timezone },
    profile: await mailboxProfileOf(db, ctx, mailbox.id),
    original,
  });
  let external = false;
  if (email !== null) {
    const match = matchSender(email.from_address, await listSenderRules(db, ctx, mailbox.id));
    const internalAddresses = [
      ...(await listMailboxes(db, ctx)).map((box) => box.address),
      ...(await listDelegateAddresses(db, ctx, { activeOnly: true })),
    ];
    external = isExternalSender(email.from_address, {
      internalAddresses,
      whitelisted: match.whitelisted,
      vip: match.vip,
    });
  }
  const delegate = "delegate_id" in draft ? await getDelegate(db, ctx, draft.delegate_id) : undefined;
  const view = approvalViewOf(message, {
    draft,
    original,
    external,
    synthetic: email !== null && isSyntheticMessageId(email.message_id_header),
    recipientInactive: delegate !== undefined && !delegate.active,
  });
  // The edit version of the send (from 2 on the card says so) and the link to the panel.
  view.version = draftVersion(draft);
  const panelUrl = panelUrlOf(options.panelBase, send.id);
  if (panelUrl !== undefined) view.panelUrl = panelUrl;
  // The card line invites an edit in the mail client only where the system stops a changed copy (a reply, or the flag on).
  if (await isFeatureOn(db, ctx, "draft_copy_check")) view.copyCheck = true;
  // A reply is stopped when the mail is answered, but only `\Answered` on the original shows that while the Sent mail is not read
  // (the flag `sent_sync` or the switch of the mailbox is off): the card says "I cannot see your sent mail".
  if (draft.kind === "reply" && !(await isSentVisible(db, ctx, mailbox.id))) view.sentVisible = false;
  // A reply goes to the stored From. The card also shows the Reply-To of the original when it names other addresses
  let replyAllAdds: string[] | undefined;
  if (draft.kind === "reply" && email !== null && send.email_id !== null) {
    const emailId = send.email_id;
    const mail = (await replyFactsOf(db, ctx, [emailId])).get(emailId);
    const replyTo = mail?.replyTo ?? [];
    // The addresses that a tap on Use Reply-To could send to: `otherReplyTo` is the one rule (no sender, no own mailbox, also not
    // its `+tag` form, bare addresses only), so the line and the button agree. Lower case, at most 5.
    const others =
      mail === undefined || mail.fromAddress === null
        ? []
        : otherReplyTo({ from: mail.fromAddress, replyTo, own: mail.ownAddresses })
            .map((address) => address.toLowerCase())
            .filter((address) => address.length <= 320)
            .slice(0, 5);
    if (others.length > 0) view.replyTo = others;
    // The buttons that change the recipients: only when there is something to change to (the rules of the service are the same ones).
    if (mail !== undefined && mail.fromAddress !== null) {
      const facts = { from: mail.fromAddress, own: mail.ownAddresses };
      const participants = otherParticipants({
        ...facts,
        toAddresses: mail.toAddresses,
        ccAddresses: mail.ccAddresses,
      });
      if (draft.recipients !== "all" && participants.length > 0 && participants.length <= REPLY_CC_MAX) {
        view.canReplyAll = true;
        replyAllAdds = participants;
      }
      if (draft.recipients !== "reply_to" && otherReplyTo({ ...facts, replyTo }).length > 0) {
        view.canUseReplyTo = true;
      }
    }
  }
  return {
    view,
    subject: message.subject,
    quote: message.parts.quote,
    ...(replyAllAdds === undefined ? {} : { replyAllAdds }),
  };
}

// A card that the renderer refuses (a follow-up whose To and Cc do not fit one message, rule 2,400 characters) is refused again at
// every run. The same rows would fill the limit of `listSendsToNotify` and hold back newer cards. The process remembers
// their ids and lists the others; a restart tries each once more. Nothing is written: the send stays `awaiting_approval` with
// `notified_at` null, so the panel shows it and the 7-day limit of an unnotified send applies. Only a refusal of the renderer
// counts: another error (a lost connection) may pass at the next run.
const refusedCards = new Set<string>();
const REFUSED_CARDS_MAX = 1000;

// Tests only: the memory of the refused cards is process-wide.
export function forgetRefusedCards(): void {
  refusedCards.clear();
}

// One request per owner for each send that waits, after its draft is applied. No owner: nothing is queued or marked.
async function detectApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: NoticeRecipient[],
  timeZone: string,
  now: Date,
  webBaseUrl: string | undefined
): Promise<void> {
  if (owners.length === 0) return;
  const rows = await listSendsToNotify(db, ctx, { limit: APPROVAL_LIMIT, skip: [...refusedCards] });
  if (rows.length === 0) return;
  // Read once per run. The link goes on the card only when the panel page is on and the base URL is set.
  const panelBase = webBaseUrl !== undefined && (await isFeatureOn(db, ctx, "approvals_page")) ? webBaseUrl : undefined;
  for (const row of rows) {
    try {
      // A follow-up card names recipients of the owner's own sent mail: the consent gate splits the owners.
      // The send began to wait when its row last changed.
      const eventAt = row.updated_at;
      const gate: LoopGate =
        row.loop_id === null
          ? { covered: owners, withheld: [], pushWithheld: [] }
          : await splitByLoopConsent(db, ctx, owners, { kind: "approval", eventAt, now });
      const noticeView =
        gate.covered.length === 0 && gate.pushWithheld.length === 0
          ? undefined
          : {
              actionId: row.id,
              view: (await approvalViewFor(db, ctx, row, panelBase === undefined ? {} : { panelBase })).view,
              now,
              timeZone,
            };
      await inTransaction(db, async (trx) => {
        if (noticeView !== undefined) {
          const queueFor = (owner: NoticeRecipient, only?: "push") =>
            queue(
              trx,
              ctx,
              {
                userId: owner.userId,
                locale: owner.locale,
                kind: "approval",
                dedupKey: `approval:${row.id}`,
                ...(row.email_id === null ? {} : { emailId: row.email_id }),
                ...(row.loop_id === null ? {} : { loopId: row.loop_id }),
                eventAt,
                ...(only === undefined ? {} : { only }),
                view: noticeView,
              },
              now
            );
          for (const owner of gate.covered) await queueFor(owner);
          for (const owner of gate.pushWithheld) await queueFor(owner, "push");
        }
        await queueLoopConsentLines(trx, ctx, gate.withheld, {
          about: "approval",
          panelUrl: panelBase === undefined ? undefined : panelListUrlOf(panelBase),
          now,
        });
        await markNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      if (error instanceof NoticeViewError) {
        if (refusedCards.size >= REFUSED_CARDS_MAX) refusedCards.clear();
        refusedCards.add(row.id);
      }
      warnSkipped("approval", row.id, error);
    }
  }
}

export const approvalDetector: Detector = {
  name: "approval",
  kinds: ["approval"],
  detect: (run) => detectApprovals(run.db, run.ctx, run.owners, run.timeZone, run.now, run.deps.webBaseUrl),
};
