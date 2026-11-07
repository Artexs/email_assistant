export function helpText(): string {
  return [
    "Commands:",
    "/digest – the digest now",
    "/status – mailboxes, last sync, LLM calls",
    "/pause – stop reading and triage of your mailboxes",
    "/resume – start them again",
    "/help – this list",
    "Tap ✅ when the AI category is right, ✏️ to correct it.",
    "↩️ under a digest line undoes what the system did to that mail (7 days).",
  ].join("\n");
}

export const LINKED_TEXT = `✅ This chat is linked. Digests and urgent notices come here.\n${helpText()}`;
export const ALREADY_LINKED_TEXT = `✅ This chat is linked already.\n${helpText()}`;
export const LINK_USED_TEXT = "This link was used already. Ask for a new link.";
export const LINK_EXPIRED_TEXT = "This link has expired (a link works for 15 minutes). Ask for a new link.";
export const ERROR_TEXT = "Something went wrong. Try again later.";
