import {
  delegationCancelAnswerSchema,
  delegationDoneAnswerSchema,
  delegationListSchema,
  delegationRemindAnswerSchema,
  type DelegationCancelAnswer,
  type DelegationDoneAnswer,
  type DelegationFilter,
  type DelegationList,
  type DelegationRemindAnswer,
} from "@ea/core/web";

import { api } from "./api";

// One page of the list. `before` is the `next` cursor of the page before (null for the first page).
export function fetchDelegations(filter: DelegationFilter, before: string | null = null): Promise<DelegationList> {
  const query = new URLSearchParams({ filter });
  if (before !== null) query.set("before", before);
  return api(`/api/delegations?${query.toString()}`, delegationListSchema);
}

const actionPath = (id: string, action: "remind" | "done" | "cancel") =>
  `/api/delegations/${encodeURIComponent(id)}/${action}`;

export function postRemind(id: string): Promise<DelegationRemindAnswer> {
  return api(actionPath(id, "remind"), delegationRemindAnswerSchema, { method: "POST", body: {} });
}

export function postDone(id: string): Promise<DelegationDoneAnswer> {
  return api(actionPath(id, "done"), delegationDoneAnswerSchema, { method: "POST", body: {} });
}

export function postCancel(id: string): Promise<DelegationCancelAnswer> {
  return api(actionPath(id, "cancel"), delegationCancelAnswerSchema, { method: "POST", body: {} });
}
