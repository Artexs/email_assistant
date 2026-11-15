import {
  ADDRESS_PATTERN,
  DELEGATE_NAME_MAX,
  DELEGATE_TAG_MAX,
  DELEGATE_TAGS_MAX,
  type Delegate,
  type DelegateAddBody,
  type DelegatePatchBody,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { errorText } from "./errors";

export type DelegateField = "name" | "email" | "tags";

// The tag field is one text: tags are comma-separated. The form trims each part, drops empty parts, writes lower case (the service
// stores lower case) and keeps the first of two equal tags. The service does the same, so the list shows what the form checked.
export function splitTags(text: string): string[] {
  const tags: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.trim().toLowerCase();
    if (tag !== "" && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

// The text of the tag field for the tags of a delegate (the Edit dialog starts with it).
export function tagsText(tags: readonly string[]): string {
  return tags.join(", ");
}

// The limits that the texts of the field errors name (`{max}`, `{tags}`, `{len}`).
export const FIELD_LIMITS = { max: DELEGATE_NAME_MAX, tags: DELEGATE_TAGS_MAX, len: DELEGATE_TAG_MAX } as const;

// The field that shows a text, and the text.
export interface FieldProblem {
  field: DelegateField;
  key: TextKey;
}

const FIELD_KEYS: Record<DelegateField, TextKey> = {
  name: "dlg_name_error",
  email: "dlg_email_error",
  tags: "dlg_tags_error",
};

const charCount = (text: string): number => Array.from(text).length;

function nameProblem(name: string): FieldProblem | null {
  const size = charCount(name.trim());
  return size >= 1 && size <= DELEGATE_NAME_MAX ? null : { field: "name", key: FIELD_KEYS.name };
}

function emailProblem(email: string): FieldProblem | null {
  return ADDRESS_PATTERN.test(email.trim().toLowerCase()) ? null : { field: "email", key: FIELD_KEYS.email };
}

function tagsProblem(tags: readonly string[]): FieldProblem | null {
  const ok = tags.length <= DELEGATE_TAGS_MAX && tags.every((tag) => charCount(tag) <= DELEGATE_TAG_MAX);
  return ok ? null : { field: "tags", key: FIELD_KEYS.tags };
}

export interface AddValues {
  name: string;
  email: string;
  tags: string;
}

export type AddCheck = { ok: true; body: DelegateAddBody } | ({ ok: false } & FieldProblem);

// The limits of the service, checked before the request (the server check is the real one). The first problem wins, in field order.
export function checkAdd(values: AddValues): AddCheck {
  const tags = splitTags(values.tags);
  const problem = nameProblem(values.name) ?? emailProblem(values.email) ?? tagsProblem(tags);
  if (problem !== null) return { ok: false, ...problem };
  return { ok: true, body: { name: values.name.trim(), email: values.email.trim(), tags } };
}

export interface EditValues {
  name: string;
  tags: string;
}

// The values that the Edit dialog starts with.
export function editStart(delegate: Pick<Delegate, "name" | "tags">): EditValues {
  return { name: delegate.name, tags: tagsText(delegate.tags) };
}

// What the Edit dialog sends: only the fields that differ from the delegate, after the cleaning above. `null` = nothing changed.
export function editChange(delegate: Pick<Delegate, "name" | "tags">, values: EditValues): DelegatePatchBody | null {
  const name = values.name.trim();
  const tags = splitTags(values.tags);
  const patch: DelegatePatchBody = {};
  if (name !== delegate.name) patch.name = name;
  if (tags.length !== delegate.tags.length || tags.some((tag, index) => tag !== delegate.tags[index]))
    patch.tags = tags;
  return Object.keys(patch).length === 0 ? null : patch;
}

export type EditCheck =
  | { ok: true; patch: DelegatePatchBody }
  // A field problem (the dialog shows it under the field), or `unchanged` (nothing differs: Save stays off).
  | ({ ok: false; unchanged: false } & FieldProblem)
  | { ok: false; unchanged: true };

export function checkEdit(delegate: Pick<Delegate, "name" | "tags">, values: EditValues): EditCheck {
  const problem = nameProblem(values.name) ?? tagsProblem(splitTags(values.tags));
  if (problem !== null) return { ok: false, unchanged: false, ...problem };
  const patch = editChange(delegate, values);
  return patch === null ? { ok: false, unchanged: true } : { ok: true, patch };
}

// What a form does with a failed save: show a text under a field (the cursor goes there), say that the delegate is gone, or show a
// text for the whole form.
export type SaveOutcome =
  | { kind: "field"; field: DelegateField; key: TextKey }
  | { kind: "gone" }
  | { kind: "error"; key: TextKey };

function isField(path: string | undefined): path is DelegateField {
  return path === "name" || path === "email" || path === "tags";
}

// POST /api/delegates: 409 `exists` and 400 `mailbox_address` have their own text (the address field shows them); 400 `validation`
// names the field in `details[0].path`. Any other answer gets the general text of its code.
export function addOutcome(error: unknown): SaveOutcome {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === "exists") return { kind: "field", field: "email", key: "dlg_exists" };
    if (error.status === 400 && error.code === "mailbox_address") {
      return { kind: "field", field: "email", key: "dlg_mailbox_address" };
    }
    if (error.status === 400 && error.code === "validation") {
      const path = error.details?.[0]?.path;
      if (isField(path)) return { kind: "field", field: path, key: FIELD_KEYS[path] };
    }
  }
  return { kind: "error", key: errorText(error) };
}

// PATCH /api/delegates/:id: a 404 says that the delegate is gone; a 400 `validation` names `name` or `tags` (never the address).
export function patchOutcome(error: unknown): SaveOutcome {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: "gone" };
    if (error.status === 400 && error.code === "validation") {
      const path = error.details?.[0]?.path;
      if (path === "name" || path === "tags") return { kind: "field", field: path, key: FIELD_KEYS[path] };
    }
  }
  return { kind: "error", key: errorText(error) };
}
