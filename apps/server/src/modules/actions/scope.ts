import { isTestMail, type TestMailRule } from "../mail";

import type { MailboxClaimFilter, SendClaimFilter } from "./repo";

// D8: `off` = no mailbox change; `synthetic` = test mail only (a synthetic Message-ID or a sender of `testMail`); `all` = real mail of every mailbox (the mode of each mailbox is the consent).
export type ActionsScope = { kind: "off" } | { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };

// D16: `off` = no send; `self` = only to the listed addresses; `all` = every send, always after an owner's tap.
export type SendScope = { kind: "off" } | { kind: "self"; addresses: string[] } | { kind: "all" };

// Pure. The committer and the Undo tap use it. `all` admits every mailbox.
export function claimFilterFor(scope: ActionsScope): MailboxClaimFilter {
  if (scope.kind === "off") return { kind: "none" };
  if (scope.kind === "synthetic") return { kind: "synthetic", testMail: scope.testMail };
  return { kind: "all" };
}

// Pure. Does the claim filter let this mail through? The Undo tap uses it (M9).
export function scopeAdmits(
  filter: MailboxClaimFilter,
  mail: { messageIdHeader: string | null; fromAddress: string | null }
): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "synthetic") return isTestMail(mail, filter.testMail);
  return false;
}

// Pure. `all` admits every mailbox.
export function sendFilterFor(scope: SendScope): SendClaimFilter {
  if (scope.kind === "off") return { kind: "none" };
  if (scope.kind === "self")
    return { kind: "self", addresses: scope.addresses.map((address) => address.toLowerCase()) };
  return { kind: "all" };
}

// Pure. Does the send filter let a send to these recipients through? `self` needs every recipient in the list.
export function sendScopeAdmits(filter: SendClaimFilter, to: readonly string[]): boolean {
  if (filter.kind === "all") return true;
  if (filter.kind === "none") return false;
  return to.length > 0 && to.every((address) => filter.addresses.includes(address.toLowerCase()));
}
