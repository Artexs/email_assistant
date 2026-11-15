import {
  delegateListSchema,
  delegateSchema,
  type Delegate,
  type DelegateAddBody,
  type DelegateList,
  type DelegatePatchBody,
} from "@ea/core/web";

import { api } from "./api";

export function fetchDelegates(): Promise<DelegateList> {
  return api("/api/delegates", delegateListSchema);
}

// 201 `Delegate`.
export function postDelegate(body: DelegateAddBody): Promise<Delegate> {
  return api("/api/delegates", delegateSchema, { method: "POST", body });
}

export function patchDelegate(id: string, body: DelegatePatchBody): Promise<Delegate> {
  return api(`/api/delegates/${encodeURIComponent(id)}`, delegateSchema, { method: "PATCH", body });
}
