import {
  loopFollowUpAnswerSchema,
  loopLaterAnswerSchema,
  loopListSchema,
  loopOkAnswerSchema,
  type LoopFilterName,
  type LoopFollowUpAnswer,
  type LoopKindName,
  type LoopLaterAnswer,
  type LoopList,
  type LoopOkAnswer,
} from "@ea/core/web";

import { api } from "./api";

// One page of one kind. `before` is the `next` cursor of the page before (null for the first page).
export function fetchLoops(
  kind: LoopKindName,
  filter: LoopFilterName,
  before: string | null = null
): Promise<LoopList> {
  const query = new URLSearchParams({ kind, filter });
  if (before !== null) query.set("before", before);
  return api(`/api/loops?${query.toString()}`, loopListSchema);
}

const actionPath = (id: string, action: string) => `/api/loops/${encodeURIComponent(id)}/${action}`;

export function postFollowUp(id: string): Promise<LoopFollowUpAnswer> {
  return api(actionPath(id, "follow-up"), loopFollowUpAnswerSchema, { method: "POST", body: {} });
}

export function postLater(id: string): Promise<LoopLaterAnswer> {
  return api(actionPath(id, "later"), loopLaterAnswerSchema, { method: "POST", body: {} });
}

// Done, Drop, Reopen and Untrack share one answer shape.
export function postLoopOk(id: string, action: "done" | "drop" | "reopen" | "untrack"): Promise<LoopOkAnswer> {
  return api(actionPath(id, action), loopOkAnswerSchema, { method: "POST", body: {} });
}
