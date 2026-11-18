import type {
  SuggestionCandidate,
  SuggestionContext,
  SuggestionInput,
  SuggestionKind,
  SuggestionReason,
} from "./types";

// Suggestion rules (F120 D10, PD-108, discovery notes §2.6). Pure: no clock, no hash; the caller passes `keyOf`.
const WEEKLY_CAP = 3;
const VIP_MIN_ANSWERED = 5;
const VIP_MIN_FLAGGED = 3;
const WHITELIST_MIN_RESCUED = 2;
const BLOCKLIST_MIN_CORRECTED = 2;
const DOMAIN_MIN_SENDERS = 2;
const KIND_ORDER: Record<SuggestionKind, number> = { whitelist: 0, vip: 1, blocklist: 2 };

interface Ranked {
  candidate: SuggestionCandidate;
  // The sort counts: the main count, then the second one (VIP only).
  main: number;
  second: number;
}

interface AddressHit {
  input: SuggestionInput;
  reason: SuggestionReason;
  main: number;
  second: number;
}

function vipHit(input: SuggestionInput): AddressHit | null {
  if (input.isOwn || input.isNoreply || input.isVip || input.relation === "bulk" || input.suspicious90 > 0) return null;
  // At least 60% answered: answered / received >= 6 / 10.
  const answeredEnough = input.answered30 >= VIP_MIN_ANSWERED && input.answered30 * 10 >= input.received30 * 6;
  const flaggedEnough = input.flagged30 >= VIP_MIN_FLAGGED;
  if (!answeredEnough && !flaggedEnough) return null;
  const reason: SuggestionReason = {};
  if (answeredEnough) {
    reason.received = input.received30;
    reason.answered = input.answered30;
  }
  if (flaggedEnough) reason.flagged = input.flagged30;
  return { input, reason, main: input.answered30, second: input.flagged30 };
}

function whitelistHit(input: SuggestionInput): AddressHit | null {
  if (input.isOwn || input.isWhitelisted || input.isBlocklisted || input.suspicious90 > 0) return null;
  if (input.rescued90 < WHITELIST_MIN_RESCUED) return null;
  return { input, reason: { rescued: input.rescued90 }, main: input.rescued90, second: 0 };
}

function blocklistHit(input: SuggestionInput, sentCoverage: boolean): AddressHit | null {
  // Without Sent coverage "never wrote to them" cannot be known (D16).
  if (!sentCoverage) return null;
  if (input.isOwn || input.isVip || input.isWhitelisted || input.isBlocklisted || input.isDelegate) return null;
  if (input.relation === "known" || input.relation === "delegate") return null;
  if (input.correctedToSpam90 < BLOCKLIST_MIN_CORRECTED) return null;
  if (input.answered90 !== 0 || input.userMailsTo90 !== 0) return null;
  return { input, reason: { corrected: input.correctedToSpam90 }, main: input.correctedToSpam90, second: 0 };
}

// A domain blocklist never covers a sender that the user knows, or that a rule protects.
function protectedFromDomainBlock(input: SuggestionInput): boolean {
  return (
    input.relation === "known" ||
    input.relation === "delegate" ||
    input.isDelegate ||
    input.isVip ||
    input.isWhitelisted ||
    input.answered90 > 0 ||
    input.userMailsTo90 > 0
  );
}

// A domain whitelist never covers a sender with a suspicious mail or a block rule.
function protectedFromDomainAllow(input: SuggestionInput): boolean {
  return input.suspicious90 > 0 || input.isBlocklisted;
}

function rankAddress(kind: SuggestionKind, hit: AddressHit, ctx: SuggestionContext): Ranked {
  const { address } = hit.input;
  return {
    candidate: { kind, scope: "address", pattern: address, key: ctx.keyOf(address), reason: hit.reason },
    main: hit.main,
    second: hit.second,
  };
}

function rankDomain(
  kind: "whitelist" | "blocklist",
  domain: string,
  hits: AddressHit[],
  ctx: SuggestionContext
): Ranked {
  const pattern = `@${domain}`;
  const total = hits.reduce((sum, hit) => sum + hit.main, 0);
  const reason: SuggestionReason = kind === "whitelist" ? { rescued: total } : { corrected: total };
  reason.senders = hits.length;
  return { candidate: { kind, scope: "domain", pattern, key: ctx.keyOf(pattern), reason }, main: total, second: 0 };
}

function byRank(a: Ranked, b: Ranked): number {
  return (
    KIND_ORDER[a.candidate.kind] - KIND_ORDER[b.candidate.kind] ||
    b.main - a.main ||
    b.second - a.second ||
    (a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0)
  );
}

export function suggestionsFor(inputs: readonly SuggestionInput[], ctx: SuggestionContext): SuggestionCandidate[] {
  const room = Math.max(0, WEEKLY_CAP - ctx.createdLast7Days);
  if (room === 0) return [];

  const ranked: Ranked[] = [];

  // One input per address; a repeated address counts once.
  const seen = new Set<string>();
  const unique = inputs.filter((input) => !seen.has(input.address) && seen.add(input.address));

  const allow: AddressHit[] = [];
  const block: AddressHit[] = [];
  for (const input of unique) {
    const v = vipHit(input);
    if (v !== null) ranked.push(rankAddress("vip", v, ctx));
    const w = whitelistHit(input);
    const b = blocklistHit(input, ctx.sentCoverage);
    // Both true for one key: the signals disagree, so neither.
    if (w !== null && b !== null) continue;
    if (w !== null) allow.push(w);
    if (b !== null) block.push(b);
  }

  const byDomain = new Map<string, SuggestionInput[]>();
  for (const input of unique) {
    if (input.isFreeMailDomain || input.isOwnDomain) continue;
    byDomain.set(input.domain, [...(byDomain.get(input.domain) ?? []), input]);
  }

  const groups: {
    kind: "whitelist" | "blocklist";
    hits: AddressHit[];
    isProtected(input: SuggestionInput): boolean;
  }[] = [
    { kind: "whitelist", hits: allow, isProtected: protectedFromDomainAllow },
    { kind: "blocklist", hits: block, isProtected: protectedFromDomainBlock },
  ];
  for (const { kind, hits, isProtected } of groups) {
    const covered = new Set<AddressHit>();
    for (const [domain, members] of byDomain) {
      const inDomain = hits.filter((hit) => hit.input.domain === domain);
      if (inDomain.length < DOMAIN_MIN_SENDERS || members.some(isProtected)) continue;
      ranked.push(rankDomain(kind, domain, inDomain, ctx));
      // The domain candidate replaces the address candidates of the same kind, even when it is skipped below.
      for (const hit of inDomain) covered.add(hit);
    }
    for (const hit of hits) {
      if (!covered.has(hit)) ranked.push(rankAddress(kind, hit, ctx));
    }
  }

  return ranked
    .filter(({ candidate: c }) => {
      const id = `${c.kind}:${c.scope}:${c.key}`;
      return !ctx.dismissed.has(id) && !ctx.open.has(id);
    })
    .sort(byRank)
    .slice(0, room)
    .map(({ candidate }) => candidate);
}
