import { z } from "./zod";

// The panel API of the mailbox OAuth sign-in (F117). The route, its apiDoc and the panel parse with these objects.

/** The providers a mailbox connects with. Registry order: the order of `options`. */
export const mailOAuthProviderKeys = ["microsoft", "google"] as const;
export type MailOAuthProviderKey = (typeof mailOAuthProviderKeys)[number];

export const mailOAuthProviderParamsSchema = z.object({ provider: z.enum(mailOAuthProviderKeys) });

/** `mailboxId` is set for a Reconnect of an OAuth mailbox; left out it starts a new connect. */
export const mailOAuthStartBodySchema = z.object({ mailboxId: z.uuid().optional() });
export type MailOAuthStartBody = z.infer<typeof mailOAuthStartBodySchema>;

/** The provider sign-in URL. It holds the one-time `state`: never log it. */
export const mailOAuthStartResultSchema = z.object({ url: z.string() });
export type MailOAuthStartResult = z.infer<typeof mailOAuthStartResultSchema>;

export const mailOAuthOptionsSchema = z.object({
  providers: z.array(
    z.object({
      provider: z.enum(mailOAuthProviderKeys),
      /** A new connect: the provider is configured and its flag is on for the organization. */
      connect: z.boolean(),
      /** A Reconnect: the provider is configured. */
      reconnect: z.boolean(),
    })
  ),
});
export type MailOAuthOptions = z.infer<typeof mailOAuthOptionsSchema>;
