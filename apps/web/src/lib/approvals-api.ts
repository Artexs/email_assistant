import {
  actionFeedbackAnswerSchema,
  approvalApproveAnswerSchema,
  approvalDetailSchema,
  approvalEditAnswerSchema,
  approvalListSchema,
  approvalRejectAnswerSchema,
  type ActionFeedbackAnswer,
  type ApprovalApproveAnswer,
  type ApprovalDetail,
  type ApprovalEditAnswer,
  type ApprovalEditBody,
  type ApprovalList,
  type ApprovalRejectAnswer,
  type RejectReasonBody,
} from "@ea/core/web";

import { api, ApiError } from "./api";

export function fetchApprovals(): Promise<ApprovalList> {
  return api("/api/approvals", approvalListSchema);
}

// A send that does not exist (404), or an id that is no uuid (400), is `null`: the page shows "does not exist".
export async function fetchApproval(id: string): Promise<ApprovalDetail | null> {
  try {
    return await api(`/api/approvals/${encodeURIComponent(id)}`, approvalDetailSchema);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

export function postApprove(id: string): Promise<ApprovalApproveAnswer> {
  return api(`/api/approvals/${id}/approve`, approvalApproveAnswerSchema, { method: "POST", body: {} });
}

export function postReject(id: string): Promise<ApprovalRejectAnswer> {
  return api(`/api/approvals/${id}/reject`, approvalRejectAnswerSchema, { method: "POST", body: {} });
}

// The id is the send that the dialog opened (D2). The answer names the new send: a new version, and a new request to approve.
export function postEdit(id: string, body: ApprovalEditBody): Promise<ApprovalEditAnswer> {
  return api(`/api/approvals/${encodeURIComponent(id)}/edit`, approvalEditAnswerSchema, { method: "POST", body });
}

// The reason route is the one of the Telegram reason buttons; the action id of a send is its id.
export function postRejectReason(id: string, reason: RejectReasonBody["reason"]): Promise<ActionFeedbackAnswer> {
  return api(`/api/actions/${id}/reject-reason`, actionFeedbackAnswerSchema, { method: "POST", body: { reason } });
}
