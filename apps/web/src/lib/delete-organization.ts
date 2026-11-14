import { orgNameMatches, type Me } from "@ea/core/web";
import { z } from "zod";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { singleFlight } from "./single-flight";

// F106 stage 04. The delete dialog and the login notice. The mailbox addresses go through `sessionStorage` (they are
// the only data that survives the delete); the password and the typed name never leave the form state.
export const DELETED_MAILBOXES_KEY = "ea.deleted_mailboxes";

// Owners only, with the flag `org_delete` on. The server checks both again.
export function canDeleteOrganization(me: Pick<Me, "role" | "features">): boolean {
  return me.role === "owner" && me.features.includes("org_delete");
}

export type DeleteField = "password" | "name";

export interface DeleteError {
  // The field that shows the text; null means the text stands for the whole form.
  field: DeleteField | null;
  key: TextKey;
}

// 400 `wrong_password`, 400 `wrong_name` and 429 `locked` have their own text. Every other error (a busy 503
// `internal`, a closed flag, a network error) is the generic one: nothing was deleted.
export function deleteError(error: unknown): DeleteError {
  if (error instanceof ApiError) {
    if (error.code === "wrong_password") return { field: "password", key: "del_wrong_password" };
    if (error.code === "wrong_name") return { field: "name", key: "del_wrong_name" };
    if (error.code === "locked") return { field: "password", key: "del_locked" };
  }
  return { field: null, key: "del_failed" };
}

export type DeleteOutcome = { kind: "deleted" } | { kind: "failed"; error: DeleteError };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DeleteDeps {
  request(body: { password: string; confirmName: string }): Promise<{ mailboxAddresses: string[] }>;
  // `undefined` when the browser blocks storage: the login page then shows the texts without a list.
  storage(): Store | undefined;
  goTo(url: string): void;
}

export function saveDeletedMailboxes(store: Store | undefined, addresses: string[]): void {
  try {
    store?.setItem(DELETED_MAILBOXES_KEY, JSON.stringify(addresses));
  } catch {
    // A full or blocked storage only loses the list.
  }
}

export interface DeletedNotice {
  // Empty when the key is missing or bad.
  addresses: string[];
}

const addressesSchema = z.array(z.string());

// The notice shows when the key holds a list (also without `?deleted=1`: a 401 of the `/api/me` poll can land on
// `/login?next=…` first) or when the query says `deleted=1`. The key is removed on every read.
export function takeDeletedNotice(search: string, store: Store | undefined): DeletedNotice | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(DELETED_MAILBOXES_KEY) ?? null;
    if (raw !== null) store?.removeItem(DELETED_MAILBOXES_KEY);
  } catch {
    raw = null;
  }
  let addresses: string[] = [];
  let hasKey = false;
  if (raw !== null) {
    try {
      const parsed = addressesSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        addresses = parsed.data;
        hasKey = true;
      }
    } catch {
      // A bad list is shown as no list.
    }
  }
  if (hasKey || new URLSearchParams(search).get("deleted") === "1") return { addresses };
  return null;
}

// One submit at a time (a double click or Enter twice runs one request). The password and the name are arguments:
// nothing here keeps them. Every outcome is returned as data; the caller clears the form on every outcome.
export function createDeleteRunner(deps: DeleteDeps) {
  const gate = singleFlight();
  return async function run(input: { password: string; confirmName: string }): Promise<DeleteOutcome | undefined> {
    return gate(async (): Promise<DeleteOutcome> => {
      try {
        const response = await deps.request(input);
        saveDeletedMailboxes(deps.storage(), response.mailboxAddresses);
        deps.goTo("/login?deleted=1");
        return { kind: "deleted" };
      } catch (caught) {
        return { kind: "failed", error: deleteError(caught) };
      }
    });
  };
}

export function deleteSubmitEnabled(organizationName: string, typed: string, password: string, pending: boolean) {
  return !pending && password !== "" && orgNameMatches(organizationName, typed);
}

export interface DeleteForm {
  password: string;
  name: string;
  pending: boolean;
  error: DeleteError | null;
}

export const emptyDeleteForm: DeleteForm = { password: "", name: "", pending: false, error: null };

export type DeleteFormAction =
  | { type: "password" | "name"; value: string }
  | { type: "submit" }
  | { type: "outcome"; outcome: DeleteOutcome }
  | { type: "close" };

// The form state of the dialog. The password and the typed name are cleared on close and on every outcome
// (a failure and a success), so neither survives a request. A close while the request runs does nothing.
export function deleteFormReducer(form: DeleteForm, action: DeleteFormAction): DeleteForm {
  switch (action.type) {
    case "password":
      return { ...form, password: action.value };
    case "name":
      return { ...form, name: action.value };
    case "submit":
      return { ...form, pending: true, error: null };
    case "outcome":
      // After a success the page leaves: the form stays disabled until then.
      return {
        password: "",
        name: "",
        pending: action.outcome.kind === "deleted",
        error: action.outcome.kind === "failed" ? action.outcome.error : null,
      };
    case "close":
      return form.pending ? form : emptyDeleteForm;
  }
}
