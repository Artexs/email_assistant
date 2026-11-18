import type { NewsletterItem } from "@ea/core/web";

import type { TextKey } from "../i18n/en";

import { ApiError } from "./api";

export const newslettersPath = (mailboxId: string): string => `/api/newsletters/${mailboxId}`;

export type NewsletterAction =
  | { kind: "none" } // no unsubscribe link: text only
  | { kind: "wait" } // one-click for a member (or a paused account), or a row with nothing to offer yet
  | { kind: "unsubscribe" } // one-click, no request yet, the owner may tap
  | { kind: "open"; href: string; host: string }; // the owner opens the page in a new tab

// The link of a row is mail text. The page offers it only when it parses as an `https` URL with a host and no credentials, whatever the server sent.
export function safeLink(url: string | undefined): { href: string; host: string } | null {
  if (url === undefined) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname === "" || parsed.username !== "" || parsed.password !== "") {
      return null;
    }
    return { href: parsed.href, host: parsed.hostname };
  } catch {
    return null;
  }
}

export const unsubscribePath = (mailboxId: string): string => `/api/newsletters/${mailboxId}/unsubscribe`;

/**
 * The one action of a row. A member never gets a link (the server leaves `linkUrl` out for a member) and never a button.
 * `canTap` is true for an owner whose account can write. The button shows only for a one-click row with no request: a row with a
 * request has its state (and the page as a way out when the request failed), never a second button.
 */
export function actionOf(item: NewsletterItem, canTap = false): NewsletterAction {
  const link = safeLink(item.linkUrl);
  if (link !== null && (item.method === "link" || item.request !== null)) return { kind: "open", ...link };
  if (item.method === "one_click" && item.request === null && canTap) return { kind: "unsubscribe" };
  return item.method === "none" ? { kind: "none" } : { kind: "wait" };
}

/**
 * The text key of the toast after a failed tap, or null for no toast. A second tap (409 `already_requested`) needs no text: the
 * list reloads and shows the state of the first one. A 429 is the hourly limit; any other 409 means the sender is no longer
 * offered; everything else is a failed send (the row may now be `requested`, which the reload shows).
 */
export function unsubscribeFailureKey(failure: unknown): TextKey | null {
  if (failure instanceof ApiError && failure.status === 429) return "nl_err_rate";
  if (failure instanceof ApiError && failure.status === 409)
    return failure.code === "already_requested" ? null : "nl_err_not_allowed";
  return "nl_err_send";
}
