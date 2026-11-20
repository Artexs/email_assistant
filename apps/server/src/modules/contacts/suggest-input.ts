import {
  freeMailDomains,
  isNoreplyAddress,
  isSharedHostingDomain,
  isStorableSuggestionPattern,
  isValidSenderPattern,
  matchSender,
  normalizeAddress,
  registrableDomain,
  type SenderRule,
  type SuggestionInput,
} from "@ea/core";

import type { SenderActivity } from "./activity";

// The sender rule that an accepted suggestion becomes: an address stays as it is, a domain loses the `@` (a sender rule for a
// domain has no `@`; with it the rule would never match).
export function rulePatternOf(pattern: string): string {
  return pattern.startsWith("@") ? pattern.slice(1) : pattern;
}

// A pattern is eligible when the table accepts it (`isStorableSuggestionPattern`, the same rule as the CHECK of
// `sender_suggestions.pattern`) and it can become a valid sender rule (ASCII domain). Other addresses are never suggested, so
// they cannot take one of the three weekly slots and cannot make the INSERT fail.
export function suggestionPatternEligible(pattern: string): boolean {
  return isStorableSuggestionPattern(pattern) && isValidSenderPattern(rulePatternOf(pattern));
}

export function hostOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

// An entry with no counts for an address or domain that a rule or an active delegate names, and the activity does not show.
export function ruleAndDelegateMembers(
  seen: ReadonlyMap<string, SuggestionInput>,
  rules: readonly SenderRule[],
  delegates: ReadonlySet<string>,
  ownDomains: ReadonlySet<string>
): SuggestionInput[] {
  const members = new Map<string, SuggestionInput>();
  const add = (address: string): void => {
    if (seen.has(address) || members.has(address)) return;
    members.set(address, bareInput(address, rules, delegates, ownDomains));
  };
  for (const email of delegates) add(email);
  for (const rule of rules) {
    const pattern = normalizeAddress(rule.pattern);
    // A domain rule names no address: the entry stands for the domain.
    add(pattern.includes("@") ? pattern : `domain-rule@${pattern}`);
  }
  return [...members.values()];
}

export function bareInput(
  address: string,
  rules: readonly SenderRule[],
  delegates: ReadonlySet<string>,
  ownDomains: ReadonlySet<string>
): SuggestionInput {
  const empty: SenderActivity = {
    address,
    received: 0,
    received30: 0,
    answered: 0,
    answered30: 0,
    flagged: 0,
    flagged30: 0,
    unseen7d: 0,
    movedBack: 0,
    userMailsTo: 0,
    delegationsTo: 0,
    byCategory: {},
    corrections: {},
    correctedToSpam90: 0,
    rescued90: 0,
    suspicious90: 0,
    repliedBySent90: 0,
    bulkSignals: [],
    bulkBase: 0,
    bulkMails: 0,
    medianUserReplyHours: null,
    medianTheirReplyHours: null,
    replySamplesTheirs: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    lastUserMailAt: null,
    relation: "new",
  };
  return inputOf(empty, rules, delegates, ownDomains);
}

export function inputOf(
  item: SenderActivity,
  rules: readonly SenderRule[],
  delegates: ReadonlySet<string>,
  ownDomains: ReadonlySet<string>
): SuggestionInput {
  const domain = registrableDomain(hostOf(item.address));
  const match = matchSender(item.address, rules);
  return {
    address: item.address,
    domain,
    // A shared hosting domain (`github.io`) counts like free mail: a rule on it would cover every tenant.
    isFreeMailDomain: freeMailDomains.includes(domain) || isSharedHostingDomain(domain),
    isOwnDomain: ownDomains.has(domain),
    // The pass gives no row to an own address, so none reaches this point.
    isOwn: false,
    isNoreply: isNoreplyAddress(item.address),
    relation: item.relation,
    received30: item.received30,
    answered30: item.answered30,
    flagged30: item.flagged30,
    correctedToSpam90: item.correctedToSpam90,
    rescued90: item.rescued90,
    // Answered by the IMAP flag or by a Sent reply (to any recipient): a sender that the user replied to is never blocked.
    answered90: item.answered + item.repliedBySent90,
    userMailsTo90: item.userMailsTo,
    suspicious90: item.suspicious90,
    isVip: match.vip,
    isWhitelisted: match.whitelisted,
    isBlocklisted: match.blocklisted,
    isDelegate: delegates.has(item.address),
  };
}
