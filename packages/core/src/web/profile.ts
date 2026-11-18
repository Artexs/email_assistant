import { z } from "./zod";

// F115 stage 10: the mailbox profile of reply drafts, as the routes `GET|PUT /api/mailboxes/:id/profile` and
// `POST /api/mailboxes/:id/profile/preview` carry it. The limits and the character rules are in `checkProfileInput`
// (`replies/profile.ts`): the route, the CLI and the preview all call it, and a text that fails answers 400 `validation`.

// A key that is left out stays as it is. An empty string clears the field: the fallback applies.
export const profileBodySchema = z.object({
  displayName: z.string().optional(),
  signature: z.string().optional(),
  writingStyle: z.string().optional(),
});
export type ProfileBody = z.infer<typeof profileBodySchema>;

// The stored values (null: not set) and the texts that stand in for a null (D13), so that the card shows what is used.
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
