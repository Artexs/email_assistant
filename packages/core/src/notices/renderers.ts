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

import { type NoticeKind, type NoticeRenderOptions } from "./kinds";
import { noticeViewSchemas } from "./views";

// One renderer per kind. A channel key holds one function per detail level.
export interface NoticeRenderer<S extends z.ZodType> {
  schema: S;
  telegram: { full: (view: z.output<S>, opts: NoticeRenderOptions) => OutMessage };
}

function defineRenderer<S extends z.ZodType>(renderer: NoticeRenderer<S>): NoticeRenderer<S> {
  return renderer;
}

export const noticeRenderers = {
  digest: defineRenderer({
    schema: noticeViewSchemas.digest,
    telegram: { full: (view) => ({ text: view.text, buttons: view.buttons }) },
  }),
  urgent: defineRenderer({
    schema: noticeViewSchemas.urgent,
    telegram: {
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
    telegram: { full: (view, opts) => renderAuthErrorNotice(view, textsFor(opts.locale)) },
  }),
  sync_stale: defineRenderer({
    schema: noticeViewSchemas.sync_stale,
    telegram: { full: (view, opts) => renderSyncStaleNotice(view, textsFor(opts.locale)) },
  }),
  sync_ok: defineRenderer({
    schema: noticeViewSchemas.sync_ok,
    telegram: { full: (view, opts) => renderSyncOkNotice(view, textsFor(opts.locale)) },
  }),
  action_failed: defineRenderer({
    schema: noticeViewSchemas.action_failed,
    telegram: { full: (view, opts) => renderActionFailedNotice(view, textsFor(opts.locale)) },
  }),
  approval: defineRenderer({
    schema: noticeViewSchemas.approval,
    telegram: { full: (view, opts) => renderApprovalRequest(view, textsFor(opts.locale)) },
  }),
  approval_set: defineRenderer({
    schema: noticeViewSchemas.approval_set,
    telegram: { full: (view, opts) => renderApprovalSetRequest(view, textsFor(opts.locale)) },
  }),
  send_result: defineRenderer({
    schema: noticeViewSchemas.send_result,
    telegram: {
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
    telegram: { full: (view, opts) => renderDelegationAnswered(view, textsFor(opts.locale)) },
  }),
  mailbox_removed: defineRenderer({
    schema: noticeViewSchemas.mailbox_removed,
    telegram: {
      full: (view, opts) => {
        const texts = textsFor(opts.locale).notices;
        const access = view.access;
        // No access field: a row queued before F117, or a password mailbox. Today's text.
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
    telegram: { full: (view, opts) => renderSendHeldNotice(view, textsFor(opts.locale)) },
  }),
  weekly_report: defineRenderer({
    schema: noticeViewSchemas.weekly_report,
    telegram: { full: (view, opts) => renderWeeklyReport(view, textsFor(opts.locale)) },
  }),
  host_blocked: defineRenderer({
    schema: noticeViewSchemas.host_blocked,
    telegram: { full: (view, opts) => renderHostBlockedNotice(view, textsFor(opts.locale)) },
  }),
  approval_edit: defineRenderer({
    schema: noticeViewSchemas.approval_edit,
    telegram: { full: (view, opts) => approvalEdit(view, textsFor(opts.locale)) },
  }),
  not_triaged: defineRenderer({
    schema: noticeViewSchemas.not_triaged,
    telegram: { full: (view, opts) => renderNotTriagedNotice(view, textsFor(opts.locale)) },
  }),
  sent_missing: defineRenderer({
    schema: noticeViewSchemas.sent_missing,
    telegram: { full: (view, opts) => renderSentMissingNotice(view, textsFor(opts.locale)) },
  }),
  loop_consent: defineRenderer({
    schema: noticeViewSchemas.loop_consent,
    telegram: { full: (view, opts) => renderLoopConsentNotice(view, textsFor(opts.locale)) },
  }),
  trust_report_ready: defineRenderer({
    schema: noticeViewSchemas.trust_report_ready,
    telegram: { full: (view, opts) => renderTrustReportReadyNotice(view, textsFor(opts.locale)) },
  }),
  autonomy_paused: defineRenderer({
    schema: noticeViewSchemas.autonomy_paused,
    telegram: { full: (view, opts) => renderAutonomyPausedNotice(view, textsFor(opts.locale)) },
  }),
} satisfies Record<NoticeKind, NoticeRenderer<z.ZodType>>;
