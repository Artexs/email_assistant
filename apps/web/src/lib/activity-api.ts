import {
  activityPageSchema,
  feedbackResultSchema,
  undoResultSchema,
  type ActivityWebPage,
  type FeedbackBody,
  type FeedbackResult,
  type UndoBody,
  type UndoWebResult,
} from "@ea/core/web";

import { api } from "./api";

// `query` starts with "?" (see activityQueryString).
export function fetchActivity(query: string): Promise<ActivityWebPage> {
  return api(`/api/activity${query}`, activityPageSchema);
}

export function postFeedback(body: FeedbackBody): Promise<FeedbackResult> {
  return api("/api/feedback", feedbackResultSchema, { method: "POST", body });
}

export function postUndo(body: UndoBody): Promise<UndoWebResult> {
  return api("/api/actions/undo", undoResultSchema, { method: "POST", body });
}
