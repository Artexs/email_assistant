import { z } from "./zod";

// The card checks the texts before it saves them, with the same function as the route, the CLI and the preview.
export {
  checkProfileInput,
  PROFILE_NAME_MAX,
  PROFILE_SIGNATURE_MAX,
  PROFILE_STYLE_MAX,
  profileLength,
  type ProfileErrorCode,
  type ProfileField,
} from "../replies/profile";
export {
  STYLE_FORM_LINE_MAX,
  styleAddressForms,
  styleFromForm,
  styleLengths,
  type StyleAddressForm,
  type StyleForm,
  type StyleLength,
} from "../replies/style-form";

// The mailbox profile of reply drafts, as the routes `GET|PUT /api/mailboxes/:id/profile` and
// `POST /api/mailboxes/:id/profile/preview` carry it. The limits and the character rules are in `checkProfileInput`
// (`replies/profile.ts`): the route, the CLI and the preview all call it, and a text that fails answers 400 `validation`.

// A key that is left out stays as it is. An empty string clears the field: the fallback applies.
export const profileBodySchema = z.object({
  displayName: z.string().optional(),
  signature: z.string().optional(),
  writingStyle: z.string().optional(),
});
export type ProfileBody = z.infer<typeof profileBodySchema>;

// The stored values (null: not set) and the texts that stand in for a null, so that the card shows what is used.
export const profileViewSchema = z.object({
  displayName: z.string().nullable(),
  signature: z.string().nullable(),
  writingStyle: z.string().nullable(),
  fallbackName: z.string(),
  fallbackSignature: z.string(),
});
export type ProfileView = z.infer<typeof profileViewSchema>;

// `body`: one draft on a fixed sample mail. A draft that fails a check, or a call that fails, answers `failed` with a code.
export const profilePreviewSchema = z.union([
  z.object({ body: z.string() }),
  z.object({ kind: z.literal("failed"), reason: z.string() }),
]);
export type ProfilePreview = z.infer<typeof profilePreviewSchema>;

// `POST /api/mailboxes/:id/profile/style-suggestion`: the body is `{}`; a key is a 400.
export const styleSuggestionBodySchema = z.strictObject({});

// 200: the suggested text and the number of sent mails that it read, or `failed` with a code (no model client, the daily cap, a text
// that failed a check, an answer that broke the schema, a provider error). The text is for the owner to edit; the server stores none.
export const styleSuggestionFailures = ["llm_off", "llm_cap", "checks", "output", "provider"] as const;
export const styleSuggestionAnswerSchema = z.union([
  z.strictObject({ text: z.string(), count: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal("failed"), reason: z.enum(styleSuggestionFailures) }),
]);
export type StyleSuggestionAnswer = z.infer<typeof styleSuggestionAnswerSchema>;

// 409: sent tracking is off, fewer sent mails than the minimum (with the count found), or an OAuth mailbox.
export const styleSuggestionConflictSchema = z.union([
  z.strictObject({ error: z.literal("sent_off") }),
  z.strictObject({ error: z.literal("too_few"), count: z.number().int().nonnegative() }),
  z.strictObject({ error: z.literal("blocked"), reason: z.literal("oauth_mailbox") }),
]);
export type StyleSuggestionConflict = z.infer<typeof styleSuggestionConflictSchema>;
