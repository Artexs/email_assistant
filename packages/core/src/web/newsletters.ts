// The newsletters list of one mailbox (F110 stage 23, flag `bulk_unsubscribe`, D17). Every text field is untrusted mail text:
// the panel shows it as plain text, and `senderLower` is the identity of a row (never the display name).
import { z } from "./zod";

export const newsletterMethods = ["one_click", "link", "none"] as const;
export type NewsletterMethod = (typeof newsletterMethods)[number];

/** The state of an unsubscribe request (the table `unsubscribe_requests`; stage 24 writes it). */
export const unsubscribeRequestStatuses = ["requested", "done", "failed", "refused"] as const;
export type UnsubscribeRequestStatus = (typeof unsubscribeRequestStatuses)[number];

/** The panel shows at most this many characters of a display name; the view cuts a longer one. */
export const NEWSLETTER_NAME_MAX_CHARS = 100;

export const newsletterItemSchema = z.strictObject({
  senderLower: z.string(),
  fromName: z.string().nullable(),
  /** Mails of the sender in the last 30 days that have a result. */
  count: z.number().int().min(1),
  latestAt: z.iso.datetime(),
  method: z.enum(newsletterMethods),
  /** `code`: the short result code of the request (`http_200`, `private_host`, `timeout`, ...); null while it is `requested`. */
  request: z
    .strictObject({ status: z.enum(unsubscribeRequestStatuses), at: z.iso.datetime(), code: z.string().nullable() })
    .nullable(),
  /**
   * An `https` link of the newest mail, for the owner only. Present when `method` is `link`, and when `method` is `one_click`
   * and a request exists (the owner may open the page when the request failed). Absent otherwise. The panel opens it in a new tab;
   * the server never fetches it on this route.
   */
  linkUrl: z.string().optional(),
});
export type NewsletterItem = z.infer<typeof newsletterItemSchema>;

export const newsletterListSchema = z.strictObject({ senders: z.array(newsletterItemSchema) });
export type NewsletterList = z.infer<typeof newsletterListSchema>;

/** The body of `POST /api/newsletters/:mailboxId/unsubscribe` (F110 stage 24): the sender address as the list shows it (`senderLower`). */
export const unsubscribeBodySchema = z.strictObject({ sender: z.string().min(3).max(254) });
export type UnsubscribeBody = z.infer<typeof unsubscribeBodySchema>;

/**
 * The answer of the unsubscribe tap: the end state of the request and a short code (`http_200`, `private_host`, `redirect`,
 * `timeout`, ...). The code never holds a URL and the answer of the other server is never part of it.
 */
export const unsubscribeResultSchema = z.strictObject({
  status: z.enum(["done", "failed", "refused"]),
  code: z.string().regex(/^[a-z0-9_]{1,40}$/),
  at: z.iso.datetime(),
});
export type UnsubscribeResult = z.infer<typeof unsubscribeResultSchema>;

/** The 409 body of a second tap: the state that the first tap left. */
export const unsubscribeStoredSchema = z.strictObject({
  error: z.literal("already_requested"),
  request: z.strictObject({ status: z.enum(unsubscribeRequestStatuses), at: z.iso.datetime() }),
});
export type UnsubscribeStored = z.infer<typeof unsubscribeStoredSchema>;
