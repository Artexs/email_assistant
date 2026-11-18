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
  request: z.strictObject({ status: z.enum(unsubscribeRequestStatuses), at: z.iso.datetime() }).nullable(),
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
