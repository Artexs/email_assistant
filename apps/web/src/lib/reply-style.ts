import {
  checkProfileInput,
  profilePreviewSchema,
  profileViewSchema,
  type ProfileBody,
  type ProfileErrorCode,
  type ProfileField,
  type ProfileView,
} from "@ea/core/web";

import type { TextKey } from "../i18n";

import { api, ApiError } from "./api";

// The style card of reply drafts: the routes of `replies/routes.ts`, and the pure rules that the card uses.

export function profilePath(mailboxId: string, tail = ""): string {
  return `/api/mailboxes/${encodeURIComponent(mailboxId)}/profile${tail}`;
}

export function loadProfile(mailboxId: string): Promise<ProfileView> {
  return api(profilePath(mailboxId), profileViewSchema);
}

export function saveProfile(mailboxId: string, body: ProfileBody): Promise<ProfileView> {
  return api(profilePath(mailboxId), profileViewSchema, { method: "PUT", body });
}

// The values of the card, as the fields hold them: no value is an empty string.
export type ProfileValues = Record<ProfileField, string>;

export function valuesOf(view: ProfileView): ProfileValues {
  return {
    displayName: view.displayName ?? "",
    signature: view.signature ?? "",
    writingStyle: view.writingStyle ?? "",
  };
}

// The body of a save: only the fields that changed. A field that is left out stays as it is on the server.
export function changedBody(values: ProfileValues, saved: ProfileValues): ProfileBody {
  const body: ProfileBody = {};
  if (values.displayName !== saved.displayName) body.displayName = values.displayName;
  if (values.signature !== saved.signature) body.signature = values.signature;
  if (values.writingStyle !== saved.writingStyle) body.writingStyle = values.writingStyle;
  return body;
}

const errorKeys: Record<ProfileErrorCode, TextKey> = {
  line_break: "rs_err_line_break",
  bad_character: "rs_err_bad_character",
  too_long: "rs_err_too_long",
};

export interface FieldError {
  field: ProfileField;
  key: TextKey;
}

// The check of the core, run before the call: the route, the CLI and the preview run the same one. `null`: the texts pass.
export function fieldError(values: ProfileValues): FieldError | null {
  const checked = checkProfileInput(values);
  return checked.ok ? null : { field: checked.field, key: errorKeys[checked.code] };
}

const profileFieldNames: readonly string[] = ["displayName", "signature", "writingStyle"];

// The answer of the server to a text that fails (400 `validation`: the field and a code, never the text). `null`: another error.
export function serverFieldError(error: unknown): FieldError | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  const detail = error.details?.[0];
  if (detail === undefined || !profileFieldNames.includes(detail.path)) return null;
  const key = Object.hasOwn(errorKeys, detail.message)
    ? errorKeys[detail.message as ProfileErrorCode]
    : "error_generic";
  return { field: detail.path as ProfileField, key };
}

export type PreviewAnswer = { kind: "body"; body: string } | { kind: "failed"; key: TextKey };

const failureKeys: Record<string, TextKey> = {
  llm_off: "rs_preview_llm_off",
  llm_cap: "rs_preview_cap",
};

// The reason of a failed preview is a code of the server (`checks`, `output`, `no_draft`, a provider code): only two have their own text.
export function previewFailureKey(reason: string): TextKey {
  return (Object.hasOwn(failureKeys, reason) ? failureKeys[reason] : undefined) ?? "rs_preview_failed";
}

// The preview takes the values on the card, saved or not. 429 `preview_limit` and `preview_busy` are answers, not failures of the call.
export async function previewProfile(mailboxId: string, values: ProfileValues): Promise<PreviewAnswer> {
  try {
    const answer = await api(profilePath(mailboxId, "/preview"), profilePreviewSchema, {
      method: "POST",
      body: values,
    });
    return "body" in answer
      ? { kind: "body", body: answer.body }
      : { kind: "failed", key: previewFailureKey(answer.reason) };
  } catch (error) {
    if (error instanceof ApiError && error.code === "preview_limit") return { kind: "failed", key: "rs_preview_limit" };
    if (error instanceof ApiError && error.code === "preview_busy") return { kind: "failed", key: "rs_preview_busy" };
    const field = serverFieldError(error);
    if (field !== null) return { kind: "failed", key: field.key };
    throw error;
  }
}

// The reply drafts switch needs a password mailbox (the guard of `setToolSwitch`): a mailbox that signs in with a provider cannot turn it on.
export function replySwitchBlocked(mailbox: { oauthProvider: string | null }): boolean {
  return mailbox.oauthProvider !== null;
}
