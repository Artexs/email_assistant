import { isSyntheticMessageId } from "../mail";

import type { MailboxClaimFilter, SendClaimFilter } from "./repo";

// D8: `off` = no mailbox change; `synthetic` = synthetic mail only; `all` = every mail of one test mailbox.
export type ActionsScope = { kind: "off" } | { kind: "synthetic" } | { kind: "all"; mailboxAddress: string };

// D16: `off` = no send; `self` = only to the listed addresses; `all` = every send of one test mailbox.
export type SendScope =
  | { kind: "off" }
  | { kind: "self"; addresses: string[] }
  | { kind: "all"; mailboxAddress: string };

// Pure. The committer and the Undo tap use it. `all` gives no mailbox change in any other mailbox.
export function claimFilterFor(scope: ActionsScope, mailboxAddress: string): MailboxClaimFilter {
  if (scope.kind === "off") return { kind: "none" };
  if (scope.kind === "synthetic") return { kind: "synthetic" };
  return scope.mailboxAddress.toLowerCase() === mailboxAddress.toLowerCase() ? { kind: "all" } : { kind: "none" };
}

// Pure. Does the claim filter let a mail with this Message-ID through? The Undo tap uses it (M9).
export function scopeAdmits(filter: MailboxClaimFilter, messageIdHeader: string | null): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "synthetic") return isSyntheticMessageId(messageIdHeader);
  return false;
}

// Pure. `all` sends nothing from any other mailbox.
export function sendFilterFor(scope: SendScope, mailboxAddress: string): SendClaimFilter {
  if (scope.kind === "off") return { kind: "none" };
  if (scope.kind === "self")
    return { kind: "self", addresses: scope.addresses.map((address) => address.toLowerCase()) };
  return scope.mailboxAddress.toLowerCase() === mailboxAddress.toLowerCase() ? { kind: "all" } : { kind: "none" };
}

// Pure. Does the send filter let a send to these recipients through? `self` needs every recipient in the list.
export function sendScopeAdmits(filter: SendClaimFilter, to: readonly string[]): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "none") return false;
  return to.length > 0 && to.every((address) => filter.addresses.includes(address.toLowerCase()));
}
