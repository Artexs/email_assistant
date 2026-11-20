import { cleanUserText } from "../outgoing/user-text";

// The mailbox profile of reply drafts: the display name, the signature and the writing style. One check, shared
// by the route, the CLI and the preview. Pure code: no I/O.

export const PROFILE_NAME_MAX = 100;
export const PROFILE_SIGNATURE_MAX = 1000;
export const PROFILE_STYLE_MAX = 1000;

export const profileFields = ["displayName", "signature", "writingStyle"] as const;
export type ProfileField = (typeof profileFields)[number];

/** What the user typed. A key that is left out stays as it is; an empty string clears the field (the fallback applies). */
export type ProfileInput = Partial<Record<ProfileField, string>>;
/** What a write stores: null clears the field. */
export type ProfileFields = Partial<Record<ProfileField, string | null>>;

export const profileErrorCodes = ["line_break", "bad_character", "too_long"] as const;
export type ProfileErrorCode = (typeof profileErrorCodes)[number];

export type ProfileCheck =
  | { ok: true; fields: ProfileFields }
  | { ok: false; field: ProfileField; code: ProfileErrorCode };

// A line break in the name would start a new header line. The unicode line separators count as breaks.
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;
// `<`, `>`, `"` and `@` change how a mail client reads `From: "Name" <address>`.
const HEADER_UNSAFE = /[<>"@]/;

const MAX: Record<ProfileField, number> = {
  displayName: PROFILE_NAME_MAX,
  signature: PROFILE_SIGNATURE_MAX,
  writingStyle: PROFILE_STYLE_MAX,
};

/**
 * Cleans and checks the profile text. Text goes through `cleanUserText` (control and bidi characters out). A name is one line and
 * holds none of `< > " @`. Lengths count characters (code points), as the database does. An empty text after the clean-up is
 * null. The first problem found (in the order name, signature, style) is the answer; the answer never holds the text.
 */
export function checkProfileInput(input: ProfileInput): ProfileCheck {
  const fields: ProfileFields = {};
  for (const field of profileFields) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (field === "displayName" && LINE_BREAK.test(raw)) return { ok: false, field, code: "line_break" };
    const text = cleanUserText(raw, { oneLine: field === "displayName" });
    if (field === "displayName" && HEADER_UNSAFE.test(text)) return { ok: false, field, code: "bad_character" };
    if (Array.from(text).length > MAX[field]) return { ok: false, field, code: "too_long" };
    fields[field] = text === "" ? null : text;
  }
  return { ok: true, fields };
}

/** The length that `checkProfileInput` limits: code points of the cleaned text. The card shows it as "n / max". */
export function profileLength(field: ProfileField, text: string): number {
  return Array.from(cleanUserText(text, { oneLine: field === "displayName" })).length;
}

function nonBlank(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The texts that stand in for an empty field: the name falls back to the owner name, then the address; the signature falls
 * back to the owner name too, then the address. `ownerName` is null when the organization has no owner.
 */
export function profileFallbacks(input: { ownerName: string | null; address: string }): {
  name: string;
  signature: string;
} {
  const name = nonBlank(input.ownerName) ?? input.address;
  return { name, signature: name };
}

/** The style that the prompt gets and the message builder uses at send time: the stored field, else the fallback. */
export function resolveReplyStyle(
  profile: { displayName: string | null; signature: string | null; writingStyle: string | null } | null,
  fallbacks: { name: string; signature: string }
): { displayName: string; signature: string; writingStyle: string | null } {
  return {
    displayName: nonBlank(profile?.displayName) ?? fallbacks.name,
    signature: nonBlank(profile?.signature) ?? fallbacks.signature,
    writingStyle: nonBlank(profile?.writingStyle),
  };
}
