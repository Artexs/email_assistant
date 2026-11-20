import { describe, expect, test } from "bun:test";

import { addressSuggestionBlocked, domainSuggestionBlocked, suggestionsFor } from "./suggestions";
import { suggestionReasonSchema, type SuggestionContext, type SuggestionInput } from "./types";

// The key is a fixture id: the pattern itself with a prefix, so the tests read without a real hash.
const keyOf = (value: string): string => `k:${value}`;

function ctx(over: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    dismissed: new Set(),
    open: new Set(),
    createdLast7Days: 0,
    sentCoverage: true,
    keyOf,
    ...over,
  };
}

function sender(address: string, over: Partial<SuggestionInput> = {}): SuggestionInput {
  const domain = address.split("@")[1] ?? "";
  return {
    address,
    domain,
    isFreeMailDomain: false,
    isOwnDomain: false,
    isOwn: false,
    isNoreply: false,
    relation: "new",
    received30: 0,
    answered30: 0,
    flagged30: 0,
    correctedToSpam90: 0,
    rescued90: 0,
    answered90: 0,
    userMailsTo90: 0,
    suspicious90: 0,
    isVip: false,
    isWhitelisted: false,
    isBlocklisted: false,
    isDelegate: false,
    ...over,
  };
}

const vipMail = { received30: 8, answered30: 6 };
const spammer = { correctedToSpam90: 2 };

describe("suggestionsFor: VIP", () => {
  test("6 of 8 answered gives a VIP with counts only", () => {
    const [c, ...rest] = suggestionsFor([sender("a@x.pl", vipMail)], ctx());
    expect(rest).toEqual([]);
    expect(c).toEqual({
      kind: "vip",
      scope: "address",
      pattern: "a@x.pl",
      key: "k:a@x.pl",
      reason: { received: 8, answered: 6 },
    });
  });

  test("the edge: 5 of 10 is 50%, no; 6 of 10 is 60%, yes", () => {
    expect(suggestionsFor([sender("a@x.pl", { received30: 10, answered30: 5 })], ctx())).toEqual([]);
    expect(suggestionsFor([sender("a@x.pl", { received30: 10, answered30: 6 })], ctx())).toHaveLength(1);
  });

  test("fewer than 5 answers never count, however high the share", () => {
    expect(suggestionsFor([sender("a@x.pl", { received30: 4, answered30: 4 })], ctx())).toEqual([]);
  });

  test("3 flagged mails give a VIP with the flag count", () => {
    const [c] = suggestionsFor([sender("a@x.pl", { flagged30: 3, answered30: 0 })], ctx());
    expect(c?.reason).toEqual({ flagged: 3 });
    expect(suggestionsFor([sender("a@x.pl", { flagged30: 2 })], ctx())).toEqual([]);
  });

  test("never for a bulk, noreply, suspicious, own or VIP sender", () => {
    const blocked = [
      { relation: "bulk" as const },
      { isNoreply: true },
      { suspicious90: 1 },
      { isOwn: true },
      { isVip: true },
    ];
    for (const over of blocked) {
      expect(suggestionsFor([sender("a@x.pl", { ...vipMail, ...over })], ctx())).toEqual([]);
    }
  });
});

describe("suggestionsFor: whitelist", () => {
  test("2 rescued mails give a whitelist", () => {
    const [c] = suggestionsFor([sender("a@x.pl", { rescued90: 2 })], ctx());
    expect(c).toMatchObject({ kind: "whitelist", scope: "address", reason: { rescued: 2 } });
    expect(suggestionsFor([sender("a@x.pl", { rescued90: 1 })], ctx())).toEqual([]);
  });

  test("never for a whitelisted, blocklisted, suspicious or own sender", () => {
    for (const over of [{ isWhitelisted: true }, { isBlocklisted: true }, { suspicious90: 1 }, { isOwn: true }]) {
      expect(suggestionsFor([sender("a@x.pl", { rescued90: 3, ...over })], ctx())).toEqual([]);
    }
  });
});

describe("suggestionsFor: blocklist", () => {
  test("2 corrections to spam, no answer, no mail from the user: blocklist", () => {
    const [c] = suggestionsFor([sender("a@x.pl", spammer)], ctx());
    expect(c).toMatchObject({ kind: "blocklist", scope: "address", reason: { corrected: 2 } });
    expect(suggestionsFor([sender("a@x.pl", { correctedToSpam90: 1 })], ctx())).toEqual([]);
  });

  test("a mail from the user, an answer, or a known or delegate relation stops it", () => {
    const stops = [
      { userMailsTo90: 1 },
      { answered90: 1 },
      { relation: "delegate" as const },
      { relation: "known" as const },
      { isDelegate: true },
      { isVip: true },
      { isWhitelisted: true },
      { isBlocklisted: true },
      { isOwn: true },
    ];
    for (const over of stops) {
      expect(suggestionsFor([sender("a@x.pl", { ...spammer, ...over })], ctx())).toEqual([]);
    }
  });

  test("without Sent coverage there is no blocklist; the VIP of another sender still comes", () => {
    const inputs = [sender("a@x.pl", spammer), sender("b@x.pl", vipMail)];
    const result = suggestionsFor(inputs, ctx({ sentCoverage: false }));
    expect(result.map((c) => c.kind)).toEqual(["vip"]);
  });
});

describe("suggestionsFor: conflict", () => {
  test("whitelist and blocklist both true for one sender: neither", () => {
    expect(suggestionsFor([sender("a@x.pl", { correctedToSpam90: 2, rescued90: 2 })], ctx())).toEqual([]);
  });

  test("the conflict does not hide the VIP rule of the same sender", () => {
    const both = { correctedToSpam90: 2, rescued90: 2, ...vipMail };
    expect(suggestionsFor([sender("a@x.pl", both)], ctx()).map((c) => c.kind)).toEqual(["vip"]);
  });
});

describe("suggestionsFor: domain", () => {
  test("two blocklist senders of one domain give one domain candidate and no address candidates", () => {
    const result = suggestionsFor([sender("a@acme.pl", spammer), sender("b@acme.pl", spammer)], ctx());
    expect(result).toEqual([
      {
        kind: "blocklist",
        scope: "domain",
        pattern: "@acme.pl",
        key: "k:@acme.pl",
        reason: { corrected: 4, senders: 2 },
      },
    ]);
  });

  test("a free-mail domain gives address candidates only", () => {
    const free = { isFreeMailDomain: true };
    const result = suggestionsFor(
      [sender("a@gmail.com", { ...spammer, ...free }), sender("b@gmail.com", { ...spammer, ...free })],
      ctx()
    );
    expect(result.map((c) => `${c.scope}:${c.pattern}`)).toEqual(["address:a@gmail.com", "address:b@gmail.com"]);
  });

  test("a known sender of the domain blocks the domain candidate; the address candidates stay", () => {
    const result = suggestionsFor(
      [sender("a@acme.pl", spammer), sender("b@acme.pl", spammer), sender("jan@acme.pl", { relation: "known" })],
      ctx()
    );
    expect(result.map((c) => `${c.scope}:${c.pattern}`)).toEqual(["address:a@acme.pl", "address:b@acme.pl"]);
  });

  test("a sender of the domain that the user wrote to blocks the domain candidate", () => {
    const result = suggestionsFor(
      [sender("a@acme.pl", spammer), sender("b@acme.pl", spammer), sender("jan@acme.pl", { userMailsTo90: 1 })],
      ctx()
    );
    expect(result.every((c) => c.scope === "address")).toBe(true);
    expect(result).toHaveLength(2);
  });

  test("each protected sender of the domain blocks the domain blocklist", () => {
    const protectedOnes = [
      { relation: "known" as const },
      { relation: "delegate" as const },
      { isDelegate: true },
      { isVip: true },
      { isWhitelisted: true },
      { answered90: 1 },
      { userMailsTo90: 1 },
    ];
    for (const over of protectedOnes) {
      const result = suggestionsFor(
        [sender("a@acme.pl", spammer), sender("b@acme.pl", spammer), sender("jan@acme.pl", over)],
        ctx()
      );
      expect(result.map((c) => c.scope)).toEqual(["address", "address"]);
    }
  });

  test("one address twice is one sender: no domain candidate", () => {
    const result = suggestionsFor([sender("a@acme.pl", spammer), sender("a@acme.pl", spammer)], ctx());
    expect(result.map((c) => `${c.scope}:${c.pattern}`)).toEqual(["address:a@acme.pl"]);
  });

  test("an own domain gives address candidates only", () => {
    const own = { isOwnDomain: true };
    const result = suggestionsFor(
      [sender("a@acme.pl", { ...spammer, ...own }), sender("b@acme.pl", { ...spammer, ...own })],
      ctx()
    );
    expect(result.every((c) => c.scope === "address")).toBe(true);
    expect(result).toHaveLength(2);
  });

  test("a whitelist domain needs two senders and no suspicious sender in the domain", () => {
    const rescued = { rescued90: 2 };
    expect(suggestionsFor([sender("a@beta.pl", rescued), sender("b@beta.pl", rescued)], ctx())).toMatchObject([
      { kind: "whitelist", scope: "domain", pattern: "@beta.pl", reason: { rescued: 4, senders: 2 } },
    ]);
    const withSuspicious = [
      sender("a@beta.pl", rescued),
      sender("b@beta.pl", rescued),
      sender("c@beta.pl", { suspicious90: 1 }),
    ];
    expect(suggestionsFor(withSuspicious, ctx()).every((c) => c.scope === "address")).toBe(true);
  });

  test("a blocklisted sender in the domain blocks the domain whitelist", () => {
    const rescued = { rescued90: 2 };
    const result = suggestionsFor(
      [sender("a@beta.pl", rescued), sender("b@beta.pl", rescued), sender("c@beta.pl", { isBlocklisted: true })],
      ctx()
    );
    expect(result.every((c) => c.scope === "address")).toBe(true);
  });

  test("a domain candidate is never a VIP", () => {
    const result = suggestionsFor([sender("a@acme.pl", vipMail), sender("b@acme.pl", vipMail)], ctx());
    expect(result.map((c) => `${c.kind}:${c.scope}`)).toEqual(["vip:address", "vip:address"]);
  });

  test("a dismissed domain candidate does not bring its address candidates back", () => {
    const dismissed = new Set(["blocklist:domain:k:@acme.pl"]);
    expect(suggestionsFor([sender("a@acme.pl", spammer), sender("b@acme.pl", spammer)], ctx({ dismissed }))).toEqual(
      []
    );
  });
});

describe("suggestionsFor: cap, order, skip", () => {
  const five = [
    sender("b@b.pl", spammer),
    sender("c@c.pl", { rescued90: 2 }),
    sender("d@d.pl", { rescued90: 5 }),
    sender("e@e.pl", vipMail),
    sender("f@f.pl", { received30: 9, answered30: 9 }),
  ];

  test("5 candidates and 1 created: 2 results, whitelist first, larger count first", () => {
    const result = suggestionsFor(five, ctx({ createdLast7Days: 1 }));
    expect(result.map((c) => c.pattern)).toEqual(["d@d.pl", "c@c.pl"]);
  });

  test("with room for all: whitelist, vip (more answers first), blocklist", () => {
    const result = suggestionsFor(five, ctx({ createdLast7Days: -5 }));
    expect(result.map((c) => c.pattern)).toEqual(["d@d.pl", "c@c.pl", "f@f.pl", "e@e.pl", "b@b.pl"]);
  });

  test("equal counts order by key ascending", () => {
    const result = suggestionsFor([sender("z@z.pl", { rescued90: 2 }), sender("m@m.pl", { rescued90: 2 })], ctx());
    expect(result.map((c) => c.pattern)).toEqual(["m@m.pl", "z@z.pl"]);
  });

  test("VIPs with equal answers order by flagged count, then key", () => {
    const result = suggestionsFor([sender("a@a.pl", vipMail), sender("z@z.pl", { ...vipMail, flagged30: 4 })], ctx());
    expect(result.map((c) => c.pattern)).toEqual(["z@z.pl", "a@a.pl"]);
  });

  const vip = (address: string, count: number) => sender(address, { received30: count, answered30: count });

  test("VIPs: the larger count comes first, whatever the input order and the keys", () => {
    const big = vip("z@z.pl", 9);
    const small = vip("a@a.pl", 5);
    expect(suggestionsFor([small, big], ctx()).map((c) => c.pattern)).toEqual(["z@z.pl", "a@a.pl"]);
    expect(suggestionsFor([big, small], ctx()).map((c) => c.pattern)).toEqual(["z@z.pl", "a@a.pl"]);
  });

  test("VIPs with equal counts order by key ascending, whatever the input order", () => {
    const a = vip("a@a.pl", 5);
    const b = vip("b@b.pl", 5);
    expect(suggestionsFor([a, b], ctx()).map((c) => c.pattern)).toEqual(["a@a.pl", "b@b.pl"]);
    expect(suggestionsFor([b, a], ctx()).map((c) => c.pattern)).toEqual(["a@a.pl", "b@b.pl"]);
  });

  test("a dismissed key is skipped and the next candidate fills the slot", () => {
    const four = [
      sender("a@a.pl", vipMail),
      sender("b@b.pl", { rescued90: 2 }),
      sender("c@c.pl", { rescued90: 3 }),
      sender("d@d.pl", spammer),
    ];
    const dismissed = new Set(["whitelist:address:k:c@c.pl"]);
    const result = suggestionsFor(four, ctx({ dismissed }));
    expect(result.map((c) => c.pattern)).toEqual(["b@b.pl", "a@a.pl", "d@d.pl"]);
  });

  test("an open key is skipped; the same key under another kind is not", () => {
    const open = new Set(["vip:address:k:a@a.pl"]);
    expect(suggestionsFor([sender("a@a.pl", vipMail)], ctx({ open }))).toEqual([]);
    expect(suggestionsFor([sender("a@a.pl", { rescued90: 2 })], ctx({ open }))).toHaveLength(1);
  });

  test("3 created in the last 7 days: none", () => {
    expect(suggestionsFor(five, ctx({ createdLast7Days: 3 }))).toEqual([]);
    expect(suggestionsFor(five, ctx({ createdLast7Days: 4 }))).toEqual([]);
  });

  test("a reason holds counts only and passes its own schema", () => {
    for (const c of suggestionsFor(five, ctx({ createdLast7Days: -5 }))) {
      expect(suggestionReasonSchema.safeParse(c.reason).success).toBe(true);
    }
  });
});

describe("suggestionsFor: eligible", () => {
  test("a pattern that cannot become a rule is dropped before the cap, so it takes no slot", () => {
    const inputs = [
      sender("bad@x.pl", { received30: 10, answered30: 10 }),
      ...["a", "b", "c"].map((name) => sender(`${name}@y.pl`, { received30: 8, answered30: 6 })),
    ];
    const out = suggestionsFor(inputs, ctx({ eligible: (pattern) => !pattern.startsWith("bad@") }));
    expect(out.map((c) => c.pattern).sort()).toEqual(["a@y.pl", "b@y.pl", "c@y.pl"]);
  });
});

describe("addressSuggestionBlocked", () => {
  test("VIP: bulk, noreply, a suspicious mail, an own address or a VIP rule block it; a low ratio does not", () => {
    const vip = (over: Partial<SuggestionInput>) => addressSuggestionBlocked("vip", sender("a@x.pl", over), true);
    expect(vip({ received30: 100, answered30: 1 })).toBe(false);
    expect(vip({ relation: "bulk" })).toBe(true);
    expect(vip({ isNoreply: true })).toBe(true);
    expect(vip({ suspicious90: 1 })).toBe(true);
    expect(vip({ isVip: true })).toBe(true);
    expect(vip({ isOwn: true })).toBe(true);
  });

  test("whitelist: a suspicious mail, a whitelist rule or a block rule block it", () => {
    const white = (over: Partial<SuggestionInput>) =>
      addressSuggestionBlocked("whitelist", sender("a@x.pl", over), true);
    expect(white({ rescued90: 0 })).toBe(false);
    expect(white({ suspicious90: 2 })).toBe(true);
    expect(white({ isWhitelisted: true })).toBe(true);
    expect(white({ isBlocklisted: true })).toBe(true);
  });

  test("whitelist and blocklist: when both rules are true now, both open rows are blocked", () => {
    const both = { rescued90: 2, correctedToSpam90: 2 };
    expect(addressSuggestionBlocked("whitelist", sender("a@x.pl", both), true)).toBe(true);
    expect(addressSuggestionBlocked("blocklist", sender("a@x.pl", both), true)).toBe(true);
    // Without Sent coverage the block rule is not true, so the whitelist stays.
    expect(addressSuggestionBlocked("whitelist", sender("a@x.pl", both), false)).toBe(false);
  });

  test("blocklist: no Sent coverage, a known or delegate sender, an answer, a user mail or a rule block it", () => {
    const block = (over: Partial<SuggestionInput>, coverage = true) =>
      addressSuggestionBlocked("blocklist", sender("a@x.pl", { correctedToSpam90: 2, ...over }), coverage);
    expect(block({})).toBe(false);
    expect(block({}, false)).toBe(true);
    expect(block({ relation: "known" })).toBe(true);
    expect(block({ relation: "delegate" })).toBe(true);
    expect(block({ isDelegate: true })).toBe(true);
    expect(block({ answered90: 1 })).toBe(true);
    expect(block({ userMailsTo90: 1 })).toBe(true);
    expect(block({ isVip: true })).toBe(true);
    expect(block({ isWhitelisted: true })).toBe(true);
    expect(block({ isBlocklisted: true })).toBe(true);
    // Fewer corrections than the rule needs: still not blocked (no flicker).
    expect(block({ correctedToSpam90: 0 })).toBe(false);
  });
});

describe("domainSuggestionBlocked", () => {
  const member = (over: Partial<SuggestionInput> = {}) => sender("a@acme.pl", over);

  test("a free-mail or own domain is always blocked", () => {
    expect(domainSuggestionBlocked("whitelist", [member({ isFreeMailDomain: true })], true)).toBe(true);
    expect(domainSuggestionBlocked("blocklist", [member({ isOwnDomain: true })], true)).toBe(true);
  });

  test("a blocklist needs Sent coverage and no protected member", () => {
    expect(domainSuggestionBlocked("blocklist", [member()], true)).toBe(false);
    expect(domainSuggestionBlocked("blocklist", [member()], false)).toBe(true);
    expect(domainSuggestionBlocked("blocklist", [member(), member({ relation: "known" })], true)).toBe(true);
    expect(domainSuggestionBlocked("blocklist", [member({ userMailsTo90: 1 })], true)).toBe(true);
    expect(domainSuggestionBlocked("blocklist", [member({ isDelegate: true })], true)).toBe(true);
  });

  test("a whitelist is blocked by a suspicious or blocklisted member, not by Sent coverage", () => {
    expect(domainSuggestionBlocked("whitelist", [member()], false)).toBe(false);
    expect(domainSuggestionBlocked("whitelist", [member({ suspicious90: 1 })], true)).toBe(true);
    expect(domainSuggestionBlocked("whitelist", [member({ isBlocklisted: true })], true)).toBe(true);
  });
});
