import type { z } from "zod";

import { aiTextFor } from "../digest/ai-text";
import {
  approvalEdit,
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
} from "../digest/approvals";
import type { OutMessage } from "../digest/message";
import {
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderAutonomyPausedNotice,
  renderHostBlockedNotice,
  renderNotTriagedNotice,
  renderLoopConsentNotice,
  renderRepliesReadyNotice,
  renderReplyPromptNotice,
  renderReplyResultNotice,
  renderSentMissingNotice,
  renderSendHeldNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderTrustReportReadyNotice,
  renderUrgentNotice,
} from "../digest/notices";
import { renderWeeklyReport } from "../digest/weekly";
import { describeActions } from "../digest/would-do";
import { textsFor } from "../texts";

import { noticeFactsOf } from "./facts";
import { type NoticeKind, type NoticeRenderOptions } from "./kinds";
import { minimalOf, renderMinimalDigest, renderMinimalLoopConsent, renderMinimalWeekly } from "./minimal";
import { type PushKind, pushPayloadSchema } from "./push";
import { type NoticeView, noticeViewSchemas } from "./views";

// One renderer per kind. A channel key holds one function per detail level. `mail` is optional: only the four kinds of
// `reportMailKinds` have one; for every other kind `renderNotice` answers `{ ok: false }` for a mail row.
export interface NoticeRenderer<S extends z.ZodType> {
  schema: S;
  // `minimal` is required: a kind added later without one fails the typecheck (it would send the full text to a minimal chat).
  telegram: {
    full: (view: z.output<S>, opts: NoticeRenderOptions) => OutMessage;
    minimal: (view: z.output<S>, opts: NoticeRenderOptions) => OutMessage;
  };
  mail?: { full: (view: z.output<S>, opts: NoticeRenderOptions) => OutMessage };
  // The Web Push payload of a push kind (`pushOf`): absent for every other kind.
  push?: { full: (view: z.output<S>, opts: NoticeRenderOptions) => OutMessage };
}

function defineRenderer<S extends z.ZodType>(renderer: NoticeRenderer<S>): NoticeRenderer<S> {
  return renderer;
}

// The report mail shows the facts of the Telegram notice: the same text, no buttons (a mail has no taps). Links stay in the text.
function mailOf<View>(telegram: { full: (view: View, opts: NoticeRenderOptions) => OutMessage }): {
  full: (view: View, opts: NoticeRenderOptions) => OutMessage;
} {
  return { full: (view, opts) => ({ text: telegram.full(view, opts).text, buttons: [] }) };
}

// The push payload of a kind: `{ v, kind, count, itemId, lang }` as JSON (the sender adds `id`, the row id). It holds the two facts of
// the view (`noticeFactsOf`) and the language, never a string of the view. The strict payload schema (without `id`) checks the
// result: an item id that is too long makes the render fail, so the row ends `bad_view`.
const pushPayloadBody = pushPayloadSchema.omit({ id: true });
function pushOf<K extends PushKind>(kind: K): { full: (view: NoticeView<K>, opts: NoticeRenderOptions) => OutMessage } {
  return {
    full: (view, opts) => {
      const { count, itemId } = noticeFactsOf(kind, view);
      const payload = pushPayloadBody.parse({ v: 1, kind, count, itemId, lang: opts.locale });
      return { text: JSON.stringify(payload), buttons: [] };
    },
  };
}

// The four report kinds: one Telegram renderer each; the mail renderer derives from it (`mailOf`).
const reportTelegram = {
  digest: { full: (view) => ({ text: view.text, buttons: view.buttons }), minimal: renderMinimalDigest },
  weekly_report: {
    full: (view, opts) => renderWeeklyReport(view, textsFor(opts.locale)),
    minimal: renderMinimalWeekly,
  },
  trust_report_ready: {
    full: (view, opts) => renderTrustReportReadyNotice(view, textsFor(opts.locale)),
    ...minimalOf("trust_report_ready"),
  },
  autonomy_paused: {
    full: (view, opts) => renderAutonomyPausedNotice(view, textsFor(opts.locale)),
    ...minimalOf("autonomy_paused"),
  },
} satisfies {
  digest: NoticeRenderer<(typeof noticeViewSchemas)["digest"]>["telegram"];
  weekly_report: NoticeRenderer<(typeof noticeViewSchemas)["weekly_report"]>["telegram"];
  trust_report_ready: NoticeRenderer<(typeof noticeViewSchemas)["trust_report_ready"]>["telegram"];
  autonomy_paused: NoticeRenderer<(typeof noticeViewSchemas)["autonomy_paused"]>["telegram"];
};

export const noticeRenderers = {
  digest: defineRenderer({
    schema: noticeViewSchemas.digest,
    telegram: reportTelegram.digest,
    mail: mailOf(reportTelegram.digest),
  }),
  urgent: defineRenderer({
    schema: noticeViewSchemas.urgent,
    push: pushOf("urgent"),
    telegram: {
      ...minimalOf("urgent"),
      full: (view, opts) => {
        const texts = textsFor(opts.locale);
        return renderUrgentNotice(
          {
            emailId: view.emailId,
            from: view.from,
            subject: view.subject,
            aiText: aiTextFor(
              {
                category: "urgent",
                reasonCode: view.ai.reasonCode,
                reason: view.ai.reason,
                summary: null,
                modelCategory: null,
                confidence: 0,
              },
              texts
            ),
            receivedAt: view.receivedAt,
            synthetic: view.synthetic,
            folderTag: view.folderTag,
            wouldDo: describeActions(
              view.actions,
              new Map(Object.entries(view.delegateNames)),
              { stayFolder: view.stayFolder },
              texts
            ),
            ...(view.suspicious === undefined ? {} : { suspicious: view.suspicious }),
            ...(view.attachments === undefined ? {} : { attachments: view.attachments }),
            confidence: view.confidence,
            rule: view.rule,
            ...(view.delegable === true ? { delegable: true } : {}),
            ...(view.draftable === true ? { draftable: true } : {}),
            now: view.now,
            timeZone: view.timeZone,
          },
          texts
        );
      },
    },
  }),
  auth_error: defineRenderer({
    schema: noticeViewSchemas.auth_error,
    push: pushOf("auth_error"),
    telegram: { full: (view, opts) => renderAuthErrorNotice(view, textsFor(opts.locale)), ...minimalOf("auth_error") },
  }),
  sync_stale: defineRenderer({
    schema: noticeViewSchemas.sync_stale,
    push: pushOf("sync_stale"),
    telegram: { full: (view, opts) => renderSyncStaleNotice(view, textsFor(opts.locale)), ...minimalOf("sync_stale") },
  }),
  sync_ok: defineRenderer({
    schema: noticeViewSchemas.sync_ok,
    push: pushOf("sync_ok"),
    telegram: { full: (view, opts) => renderSyncOkNotice(view, textsFor(opts.locale)), ...minimalOf("sync_ok") },
  }),
  action_failed: defineRenderer({
    schema: noticeViewSchemas.action_failed,
    push: pushOf("action_failed"),
    telegram: {
      full: (view, opts) => renderActionFailedNotice(view, textsFor(opts.locale)),
      ...minimalOf("action_failed"),
    },
  }),
  approval: defineRenderer({
    schema: noticeViewSchemas.approval,
    push: pushOf("approval"),
    telegram: { full: (view, opts) => renderApprovalRequest(view, textsFor(opts.locale)), ...minimalOf("approval") },
  }),
  approval_set: defineRenderer({
    schema: noticeViewSchemas.approval_set,
    push: pushOf("approval_set"),
    telegram: {
      full: (view, opts) => renderApprovalSetRequest(view, textsFor(opts.locale)),
      ...minimalOf("approval_set"),
    },
  }),
  send_result: defineRenderer({
    schema: noticeViewSchemas.send_result,
    push: pushOf("send_result"),
    telegram: {
      ...minimalOf("send_result"),
      full: (view, opts) => {
        const texts = textsFor(opts.locale);
        return renderSendResult(
          {
            ...view,
            recipient: { name: view.recipient.name, address: view.recipient.address ?? texts.common.unknownAddress },
          },
          texts
        );
      },
    },
  }),
  delegation_answered: defineRenderer({
    schema: noticeViewSchemas.delegation_answered,
    push: pushOf("delegation_answered"),
    telegram: {
      full: (view, opts) => renderDelegationAnswered(view, textsFor(opts.locale)),
      ...minimalOf("delegation_answered"),
    },
  }),
  mailbox_removed: defineRenderer({
    schema: noticeViewSchemas.mailbox_removed,
    push: pushOf("mailbox_removed"),
    telegram: {
      ...minimalOf("mailbox_removed"),
      full: (view, opts) => {
        const texts = textsFor(opts.locale).notices;
        const access = view.access;
        // No access field: a row queued before the field existed, or a password mailbox. Today's text.
        if (access === undefined) return { text: texts.mailboxRemoved, buttons: [] };
        const text = {
          google:
            access.revoked === true
              ? texts.mailboxRemovedAccess.googleRevoked
              : texts.mailboxRemovedAccess.googleFailed,
          microsoft_work: texts.mailboxRemovedAccess.microsoftWork,
          microsoft_personal: texts.mailboxRemovedAccess.microsoftPersonal,
        }[access.page];
        return { text, buttons: [] };
      },
    },
  }),
  send_held: defineRenderer({
    schema: noticeViewSchemas.send_held,
    push: pushOf("send_held"),
    telegram: { full: (view, opts) => renderSendHeldNotice(view, textsFor(opts.locale)), ...minimalOf("send_held") },
  }),
  weekly_report: defineRenderer({
    schema: noticeViewSchemas.weekly_report,
    telegram: reportTelegram.weekly_report,
    mail: mailOf(reportTelegram.weekly_report),
  }),
  host_blocked: defineRenderer({
    schema: noticeViewSchemas.host_blocked,
    push: pushOf("host_blocked"),
    telegram: {
      full: (view, opts) => renderHostBlockedNotice(view, textsFor(opts.locale)),
      ...minimalOf("host_blocked"),
    },
  }),
  approval_edit: defineRenderer({
    schema: noticeViewSchemas.approval_edit,
    // The edit line of a card: the stored text of the card plus one status line. The card is already in that chat.
    telegram: {
      full: (view, opts) => approvalEdit(view, textsFor(opts.locale)),
      // No button at the minimal level: the Reject button of a held send is in the panel.
      minimal: (view, opts) => ({ ...approvalEdit(view, textsFor(opts.locale)), buttons: [] }),
    },
  }),
  not_triaged: defineRenderer({
    schema: noticeViewSchemas.not_triaged,
    push: pushOf("not_triaged"),
    telegram: {
      full: (view, opts) => renderNotTriagedNotice(view, textsFor(opts.locale)),
      ...minimalOf("not_triaged"),
    },
  }),
  sent_missing: defineRenderer({
    schema: noticeViewSchemas.sent_missing,
    push: pushOf("sent_missing"),
    telegram: {
      full: (view, opts) => renderSentMissingNotice(view, textsFor(opts.locale)),
      ...minimalOf("sent_missing"),
    },
  }),
  loop_consent: defineRenderer({
    schema: noticeViewSchemas.loop_consent,
    telegram: {
      full: (view, opts) => renderLoopConsentNotice(view, textsFor(opts.locale)),
      minimal: renderMinimalLoopConsent,
    },
  }),
  replies_ready: defineRenderer({
    schema: noticeViewSchemas.replies_ready,
    push: pushOf("replies_ready"),
    telegram: {
      full: (view, opts) => renderRepliesReadyNotice(view, textsFor(opts.locale)),
      ...minimalOf("replies_ready"),
    },
  }),
  reply_prompt: defineRenderer({
    schema: noticeViewSchemas.reply_prompt,
    // The question that opens the reply box: a fixed line, no view string, no button. The same for both levels.
    telegram: {
      full: (_view, opts) => renderReplyPromptNotice(textsFor(opts.locale)),
      minimal: (_view, opts) => renderReplyPromptNotice(textsFor(opts.locale)),
    },
  }),
  reply_result: defineRenderer({
    schema: noticeViewSchemas.reply_result,
    telegram: {
      full: (view, opts) => renderReplyResultNotice(view, textsFor(opts.locale)),
      ...minimalOf("reply_result"),
    },
  }),
  trust_report_ready: defineRenderer({
    schema: noticeViewSchemas.trust_report_ready,
    telegram: reportTelegram.trust_report_ready,
    mail: mailOf(reportTelegram.trust_report_ready),
  }),
  autonomy_paused: defineRenderer({
    schema: noticeViewSchemas.autonomy_paused,
    telegram: reportTelegram.autonomy_paused,
    mail: mailOf(reportTelegram.autonomy_paused),
  }),
} satisfies Record<NoticeKind, NoticeRenderer<z.ZodType>>;
