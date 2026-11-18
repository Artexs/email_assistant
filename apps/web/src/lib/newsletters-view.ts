import type { NewsletterItem } from "@ea/core/web";

export const newslettersPath = (mailboxId: string): string => `/api/newsletters/${mailboxId}`;

export type NewsletterAction =
  | { kind: "none" } // no unsubscribe link: text only
  | { kind: "wait" } // one-click: the button comes with F110 stage 24
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

/** The one action of a row. A member never gets a link (the server leaves `linkUrl` out for a member). */
export function actionOf(item: NewsletterItem): NewsletterAction {
  const link = safeLink(item.linkUrl);
  if (link !== null && (item.method === "link" || item.request !== null)) return { kind: "open", ...link };
  return item.method === "none" ? { kind: "none" } : { kind: "wait" };
}
