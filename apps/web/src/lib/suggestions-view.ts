import type { SuggestionItem } from "@ea/core/web";

import type { TextKey } from "../i18n/en";

import { ApiError } from "./api";
import { errorText } from "./errors";

export const suggestionsPath = (mailboxId: string): string => `/api/suggestions/${encodeURIComponent(mailboxId)}`;

export type SuggestionAction = "accept" | "dismiss";

export const suggestionActionPath = (id: string, action: SuggestionAction): string =>
  `/api/suggestions/${encodeURIComponent(id)}/${action}`;

export interface ReasonLine {
  key: TextKey;
  vars: Record<string, number>;
}

// The reason of a row as text keys and counts. A VIP row can hold both reasons (answers and flags); a whitelist or blocklist row
// holds one count, and a domain row also the number of senders.
export function reasonLines(item: Pick<SuggestionItem, "kind" | "scope" | "reason">): ReasonLine[] {
  const { reason } = item;
  const domain = item.scope === "domain" && reason.senders !== undefined;
  const senders = reason.senders ?? 0;
  if (item.kind === "vip") {
    const lines: ReasonLine[] = [];
    if (reason.answered !== undefined && reason.received !== undefined) {
      lines.push({ key: "sg_reason_vip_answered", vars: { answered: reason.answered, received: reason.received } });
    }
    if (reason.flagged !== undefined) lines.push({ key: "sg_reason_vip_flagged", vars: { flagged: reason.flagged } });
    return lines;
  }
  if (item.kind === "whitelist") {
    if (reason.rescued === undefined) return [];
    return domain
      ? [{ key: "sg_reason_whitelist_domain", vars: { rescued: reason.rescued, senders } }]
      : [{ key: "sg_reason_whitelist", vars: { rescued: reason.rescued } }];
  }
  if (reason.corrected === undefined) return [];
  return domain
    ? [{ key: "sg_reason_blocklist_domain", vars: { corrected: reason.corrected, senders } }]
    : [{ key: "sg_reason_blocklist", vars: { corrected: reason.corrected } }];
}

// A 404 on the list means the flag is off (or the mailbox is gone): the card is not shown and asks for nothing more.
export function suggestionsGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// The mailboxes whose list may show and the one that shows now. A mailbox whose list answered 404 (the flag is off, or the mailbox is
// gone) is left out, the others stay; the chosen one wins while it is in; else the first one. No mailbox left: no card.
export function pickMailbox<T extends { id: string }>(
  mailboxes: readonly T[],
  gone: ReadonlySet<string>,
  chosen: string | null
): { open: T[]; mailbox: T | undefined } {
  const open = mailboxes.filter((item) => !gone.has(item.id));
  return { open, mailbox: open.find((item) => item.id === chosen) ?? open[0] };
}

export interface ActionOutcome {
  toast: { kind: "success" | "error"; key: TextKey } | null;
  // The list of suggestions loads again.
  reload: boolean;
  // The rule list of the page loads again.
  rulesChanged: boolean;
}

// What the page does after Accept; `failure` is null for a 200. `already` (another tap or tab got there first) needs no toast: the
// reload shows the state. `rule_limit` keeps the row open. `not_available` means the sender is protected now and the row ended.
export function acceptOutcome(failure: unknown = null): ActionOutcome {
  if (failure === null)
    return { toast: { kind: "success", key: "rule_added_toast" }, reload: true, rulesChanged: true };
  if (failure instanceof ApiError && failure.status === 409) {
    if (failure.code === "already") return { toast: null, reload: true, rulesChanged: true };
    if (failure.code === "not_available") {
      return { toast: { kind: "error", key: "sg_not_available" }, reload: true, rulesChanged: false };
    }
    return { toast: { kind: "error", key: errorText(failure) }, reload: false, rulesChanged: false };
  }
  if (failure instanceof ApiError && failure.status === 404) {
    return { toast: { kind: "error", key: "err_not_found" }, reload: true, rulesChanged: false };
  }
  return { toast: { kind: "error", key: errorText(failure) }, reload: false, rulesChanged: false };
}

export function dismissOutcome(failure: unknown = null): ActionOutcome {
  if (failure === null)
    return { toast: { kind: "success", key: "sg_dismissed_toast" }, reload: true, rulesChanged: false };
  if (failure instanceof ApiError && failure.status === 409 && failure.code === "already") {
    return { toast: null, reload: true, rulesChanged: false };
  }
  if (failure instanceof ApiError && failure.status === 404) {
    return { toast: { kind: "error", key: "err_not_found" }, reload: true, rulesChanged: false };
  }
  return { toast: { kind: "error", key: errorText(failure) }, reload: false, rulesChanged: false };
}
