import { normalizeAddress } from "../contacts/address";

import { classifierCategories, DELEGATION_CATEGORY, type Category } from "./categories";

export const senderRuleKinds = ["whitelist", "blocklist", "vip"] as const;
export type SenderRuleKind = (typeof senderRuleKinds)[number];

export const SENDER_RULE_LIMIT = 1000;

// An address `local@domain` or a domain with a dot. A leading "@" or a domain without a dot never matches.
const domainPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const addressPattern = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function isValidSenderPattern(pattern: string): boolean {
  return domainPattern.test(pattern) || addressPattern.test(pattern);
}

export interface SenderRule {
  pattern: string;
  kind: SenderRuleKind;
}

export type HardRuleResult =
  | { kind: "spam"; reasonCode: "blocklist" }
  | { kind: "classify"; allowed: Category[]; vip: boolean; whitelisted: boolean; noreply: boolean };

const NOREPLY_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
]);

function patternMatches(pattern: string, address: string): boolean {
  if (pattern === "") return false;
  if (pattern.includes("@")) return pattern === address;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

// The sender and every rule pattern go through the one address rule (`normalizeAddress`), so a rule made from a profile
// address (a Greek final sigma, a Turkish dotted capital I) matches the real sender, and a rule that the user types in
// another case matches too. The rule skips the fold for plain ASCII.
function normalizeForMatch(value: string | null): string {
  return normalizeAddress(value ?? "");
}

export function matchSender(
  fromAddress: string | null,
  rules: readonly SenderRule[]
): { whitelisted: boolean; blocklisted: boolean; vip: boolean } {
  const address = normalizeForMatch(fromAddress);
  const result = { whitelisted: false, blocklisted: false, vip: false };
  if (!address.includes("@")) return result;

  for (const rule of rules) {
    if (!patternMatches(normalizeForMatch(rule.pattern), address)) continue;
    if (rule.kind === "blocklist") result.blocklisted = true;
    if (rule.kind === "whitelist") result.whitelisted = true;
    if (rule.kind === "vip") {
      result.vip = true;
      result.whitelisted = true;
    }
  }
  return result;
}

export function isNoreplyAddress(fromAddress: string | null): boolean {
  const address = normalizeForMatch(fromAddress);
  const at = address.lastIndexOf("@");
  if (at < 1) return false;
  return NOREPLY_LOCAL_PARTS.has(address.slice(0, at).replace(/\+.*$/, ""));
}

export interface HardRuleOptions {
  delegation?: boolean; // true = the organization has at least one active delegate
}

export function applyHardRules(
  fromAddress: string | null,
  rules: readonly SenderRule[],
  opts: HardRuleOptions = {}
): HardRuleResult {
  const { whitelisted, blocklisted, vip } = matchSender(fromAddress, rules);
  if (blocklisted && !whitelisted) return { kind: "spam", reasonCode: "blocklist" };

  const allowed = whitelisted
    ? classifierCategories.filter((category) => category !== "spam")
    : [...classifierCategories];
  if (opts.delegation) allowed.push(DELEGATION_CATEGORY);
  return { kind: "classify", allowed, vip, whitelisted, noreply: isNoreplyAddress(fromAddress) };
}

// The sender rule that shaped a result: `triage_results.fields.rule`. The pattern is never stored: it can be an
// address. A VIP is also whitelisted, so `vip` wins over `whitelist`.
export function senderRuleOf(result: HardRuleResult): SenderRuleKind | null {
  if (result.kind === "spam") return "blocklist";
  if (result.vip) return "vip";
  return result.whitelisted ? "whitelist" : null;
}

// Reads the `rule` key of a stored `fields` value. An old row, or any other value, reads null.
export function readSenderRule(value: unknown): SenderRuleKind | null {
  return senderRuleKinds.find((kind) => kind === value) ?? null;
}
