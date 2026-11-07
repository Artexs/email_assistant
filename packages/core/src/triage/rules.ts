import { classifierCategories, DELEGATION_CATEGORY, type Category } from "./categories";

export const senderRuleKinds = ["whitelist", "blocklist", "vip"] as const;
export type SenderRuleKind = (typeof senderRuleKinds)[number];

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

function normalize(value: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function patternMatches(pattern: string, address: string): boolean {
  if (pattern === "") return false;
  if (pattern.includes("@")) return pattern === address;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

export function matchSender(
  fromAddress: string | null,
  rules: readonly SenderRule[]
): { whitelisted: boolean; blocklisted: boolean; vip: boolean } {
  const address = normalize(fromAddress);
  const result = { whitelisted: false, blocklisted: false, vip: false };
  if (!address.includes("@")) return result;

  for (const rule of rules) {
    if (!patternMatches(normalize(rule.pattern), address)) continue;
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
  const address = normalize(fromAddress);
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
