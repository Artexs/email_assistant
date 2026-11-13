import type { z } from "zod";

import { aiTextFor } from "../digest/ai-text";
import {
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderDelegationAnswered,
  renderSendResult,
} from "../digest/approvals";
import type { OutMessage } from "../digest/message";
import {
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "../digest/notices";
import { describeActions } from "../digest/would-do";

import { MAILBOX_REMOVED_TEXT, type NoticeKind, type NoticeRenderOptions } from "./kinds";
import { noticeViewSchemas } from "./views";

// One renderer per kind. A channel key holds one function per detail level.
export interface NoticeRenderer<S extends z.ZodType> {
  schema: S;
  // en texts for both locales until E7-T1 adds the pl texts (PD-037).
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
      full: (view) =>
        renderUrgentNotice({
          emailId: view.emailId,
          from: view.from,
          subject: view.subject,
          aiText: aiTextFor({
            category: "urgent",
            reasonCode: view.ai.reasonCode,
            reason: view.ai.reason,
            summary: null,
            modelCategory: null,
            confidence: 0,
          }),
          receivedAt: view.receivedAt,
          synthetic: view.synthetic,
          folderTag: view.folderTag,
          wouldDo: describeActions(view.actions, new Map(Object.entries(view.delegateNames)), {
            stayFolder: view.stayFolder,
          }),
          now: view.now,
          timeZone: view.timeZone,
        }),
    },
  }),
  auth_error: defineRenderer({
    schema: noticeViewSchemas.auth_error,
    telegram: { full: (view) => renderAuthErrorNotice(view) },
  }),
  sync_stale: defineRenderer({
    schema: noticeViewSchemas.sync_stale,
    telegram: { full: (view) => renderSyncStaleNotice(view) },
  }),
  sync_ok: defineRenderer({
    schema: noticeViewSchemas.sync_ok,
    telegram: { full: (view) => renderSyncOkNotice(view) },
  }),
  action_failed: defineRenderer({
    schema: noticeViewSchemas.action_failed,
    telegram: { full: (view) => renderActionFailedNotice(view) },
  }),
  approval: defineRenderer({
    schema: noticeViewSchemas.approval,
    telegram: { full: (view) => renderApprovalRequest(view) },
  }),
  approval_set: defineRenderer({
    schema: noticeViewSchemas.approval_set,
    telegram: { full: (view) => renderApprovalSetRequest(view) },
  }),
  send_result: defineRenderer({
    schema: noticeViewSchemas.send_result,
    telegram: {
      full: (view) =>
        renderSendResult({
          ...view,
          recipient: { name: view.recipient.name, address: view.recipient.address ?? "(unknown)" },
        }),
    },
  }),
  delegation_answered: defineRenderer({
    schema: noticeViewSchemas.delegation_answered,
    telegram: { full: (view) => renderDelegationAnswered(view) },
  }),
  mailbox_removed: defineRenderer({
    schema: noticeViewSchemas.mailbox_removed,
    telegram: { full: () => ({ text: MAILBOX_REMOVED_TEXT, buttons: [] }) },
  }),
} satisfies { [K in NoticeKind]: NoticeRenderer<z.ZodType> };
