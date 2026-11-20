import { describe, expect, test } from "bun:test";

import { ruleBodySchema } from "../web/rules";

import { classifierCategories } from "./categories";
import {
  applyHardRules,
  isNoreplyAddress,
  isValidSenderPattern,
  matchSender,
  readSenderRule,
  senderRuleOf,
  type SenderRule,
} from "./rules";

const noSpam = classifierCategories.filter((category) => category !== "spam");

describe("matchSender", () => {
  test("address rule matches only that address", () => {
    const rules: SenderRule[] = [{ pattern: "jan@firma.test", kind: "blocklist" }];
    expect(matchSender("jan@firma.test", rules).blocklisted).toBe(true);
    expect(matchSender("ola@firma.test", rules).blocklisted).toBe(false);
  });

  test("domain rule matches the domain and its subdomains", () => {
    const rules: SenderRule[] = [{ pattern: "firma.test", kind: "whitelist" }];
    expect(matchSender("jan@firma.test", rules).whitelisted).toBe(true);
    expect(matchSender("jan@a.firma.test", rules).whitelisted).toBe(true);
  });

  test("domain rule does not match xfirma.test", () => {
    const rules: SenderRule[] = [{ pattern: "firma.test", kind: "whitelist" }];
    expect(matchSender("jan@xfirma.test", rules).whitelisted).toBe(false);
  });

  test("ignores case and spaces", () => {
    const rules: SenderRule[] = [{ pattern: "  Firma.TEST ", kind: "blocklist" }];
    expect(matchSender("  Jan@FIRMA.test ", rules).blocklisted).toBe(true);
  });

  test("vip is also whitelisted", () => {
    const rules: SenderRule[] = [{ pattern: "boss@firma.test", kind: "vip" }];
    expect(matchSender("boss@firma.test", rules)).toEqual({ whitelisted: true, blocklisted: false, vip: true });
  });

  test("null or empty from matches nothing", () => {
    const rules: SenderRule[] = [{ pattern: "firma.test", kind: "blocklist" }];
    expect(matchSender(null, rules)).toEqual({ whitelisted: false, blocklisted: false, vip: false });
    expect(matchSender("", rules)).toEqual({ whitelisted: false, blocklisted: false, vip: false });
  });
});

describe("applyHardRules", () => {
  test("blocklist only gives spam", () => {
    const result = applyHardRules("x@spam.test", [{ pattern: "spam.test", kind: "blocklist" }]);
    expect(result).toEqual({ kind: "spam", reasonCode: "blocklist" });
  });

  test("whitelist and blocklist on the same sender classify without spam", () => {
    const result = applyHardRules("x@spam.test", [
      { pattern: "spam.test", kind: "blocklist" },
      { pattern: "x@spam.test", kind: "whitelist" },
    ]);
    expect(result).toEqual({ kind: "classify", allowed: noSpam, vip: false, whitelisted: true, noreply: false });
  });

  test("vip gives vip and whitelisted", () => {
    const result = applyHardRules("boss@firma.test", [{ pattern: "boss@firma.test", kind: "vip" }]);
    expect(result).toEqual({ kind: "classify", allowed: noSpam, vip: true, whitelisted: true, noreply: false });
  });

  test("no rule allows all classifier categories", () => {
    const result = applyHardRules("a@b.test", []);
    expect(result).toEqual({
      kind: "classify",
      allowed: [...classifierCategories],
      vip: false,
      whitelisted: false,
      noreply: false,
    });
  });

  test("null from does not match and is not noreply", () => {
    const result = applyHardRules(null, [{ pattern: "firma.test", kind: "blocklist" }]);
    expect(result).toMatchObject({ kind: "classify", whitelisted: false, noreply: false });
  });

  test("sets the noreply hint", () => {
    expect(applyHardRules("noreply@shop.test", [])).toMatchObject({ kind: "classify", noreply: true });
  });
});

describe("isNoreplyAddress", () => {
  test.each([
    "noreply@a.test",
    "no-reply@a.test",
    "no_reply@a.test",
    "donotreply@a.test",
    "do-not-reply@a.test",
    "mailer-daemon@a.test",
    "postmaster@a.test",
    "NoReply@A.TEST",
    "noreply+abc@x.test",
  ])("%s is noreply", (address) => {
    expect(isNoreplyAddress(address)).toBe(true);
  });

  test("normal, null and empty addresses are not noreply", () => {
    expect(isNoreplyAddress("jan@a.test")).toBe(false);
    expect(isNoreplyAddress("replyto@a.test")).toBe(false);
    expect(isNoreplyAddress(null)).toBe(false);
    expect(isNoreplyAddress("")).toBe(false);
  });
});

describe("applyHardRules delegation option", () => {
  const allowedOf = (result: ReturnType<typeof applyHardRules>) => (result.kind === "classify" ? result.allowed : []);

  test("without options allowed has the 5 classifier categories", () => {
    expect(allowedOf(applyHardRules("a@x.test", []))).toEqual([...classifierCategories]);
    expect(allowedOf(applyHardRules("a@x.test", []))).toHaveLength(5);
  });

  test("delegation: true adds delegation last", () => {
    const allowed = allowedOf(applyHardRules("a@x.test", [], { delegation: true }));
    expect(allowed).toHaveLength(6);
    expect(allowed[5]).toBe("delegation");
  });

  test("delegation: false adds nothing", () => {
    expect(allowedOf(applyHardRules("a@x.test", [], { delegation: false }))).toHaveLength(5);
  });

  test("whitelisted sender has no spam but has delegation", () => {
    const rules: SenderRule[] = [{ pattern: "a@x.test", kind: "whitelist" }];
    const allowed = allowedOf(applyHardRules("a@x.test", rules, { delegation: true }));
    expect(allowed).not.toContain("spam");
    expect(allowed.at(-1)).toBe("delegation");
  });

  test("blocklisted sender is spam whatever the option", () => {
    const rules: SenderRule[] = [{ pattern: "a@x.test", kind: "blocklist" }];
    expect(applyHardRules("a@x.test", rules, { delegation: true })).toEqual({ kind: "spam", reasonCode: "blocklist" });
  });

  test("noreply sender keeps delegation", () => {
    expect(allowedOf(applyHardRules("noreply@x.test", [], { delegation: true }))).toContain("delegation");
  });
});

describe("sender pattern rule", () => {
  test("accepts an address or a domain with a dot", () => {
    for (const pattern of ["anna@x.pl", "x.pl", "mail.firma.co.uk", "a.b+c@x-y.pl"]) {
      expect(isValidSenderPattern(pattern)).toBe(true);
    }
  });

  test("refuses everything else", () => {
    for (const pattern of ["@x.pl", "*.x.pl", "x", "anna@x", "anna @x.pl", ""]) {
      expect(isValidSenderPattern(pattern)).toBe(false);
    }
  });

  test("the web schema stores trim and lower case, and the match folds by the one address rule", () => {
    const parse = (pattern: string) => ruleBodySchema.parse({ kind: "whitelist", pattern }).pattern;
    expect(parse("  Boss@Firma.TEST ")).toBe("boss@firma.test");
    // The stored form keeps the final sigma; the match still finds the folded sender.
    const stored = parse("ΝΊΚΟΣ@example.gr");
    expect(stored).toBe("νίκος@example.gr");
    expect(matchSender("νίκοσ@example.gr", [{ pattern: stored, kind: "whitelist" }]).whitelisted).toBe(true);
  });
});

describe("senderRuleOf (F110 stage 16)", () => {
  const rule = (address: string, rules: SenderRule[]) => senderRuleOf(applyHardRules(address, rules));

  test("blocklist, vip, whitelist and none", () => {
    expect(rule("x@spam.test", [{ pattern: "spam.test", kind: "blocklist" }])).toBe("blocklist");
    expect(rule("b@firma.test", [{ pattern: "b@firma.test", kind: "vip" }])).toBe("vip");
    expect(rule("a@corp.test", [{ pattern: "corp.test", kind: "whitelist" }])).toBe("whitelist");
    expect(rule("a@else.test", [{ pattern: "corp.test", kind: "whitelist" }])).toBeNull();
    expect(rule("a@else.test", [])).toBeNull();
  });

  test("a VIP is also whitelisted, and a whitelist beats a blocklist hit", () => {
    const vip: SenderRule[] = [
      { pattern: "b@firma.test", kind: "vip" },
      { pattern: "firma.test", kind: "blocklist" },
    ];
    expect(rule("b@firma.test", vip)).toBe("vip");
    const white: SenderRule[] = [
      { pattern: "x@spam.test", kind: "whitelist" },
      { pattern: "spam.test", kind: "blocklist" },
    ];
    expect(rule("x@spam.test", white)).toBe("whitelist");
  });

  test("readSenderRule reads the three kinds and nothing else", () => {
    expect(readSenderRule("vip")).toBe("vip");
    expect(readSenderRule("whitelist")).toBe("whitelist");
    expect(readSenderRule("blocklist")).toBe("blocklist");
    for (const value of [null, undefined, "", "VIP", "boss@firma.test", 1, {}])
      expect(readSenderRule(value)).toBeNull();
  });
});

describe("matchSender: the address rule of the sender profiles", () => {
  test("a rule made from a folded Greek or Turkish address matches the real sender", () => {
    // The profile keeps `αννασ@` and `ilker@`; the sender arrives as `αννας@` (final sigma) and `İlker@` (dotted capital I).
    expect(matchSender("αννας@acme.pl", [{ pattern: "αννασ@acme.pl", kind: "vip" }]).vip).toBe(true);
    expect(matchSender("ΑΝΝΑΣ@ACME.PL", [{ pattern: "αννασ@acme.pl", kind: "vip" }]).vip).toBe(true);
    expect(matchSender("İlker@acme.pl", [{ pattern: "ilker@acme.pl", kind: "blocklist" }]).blocklisted).toBe(true);
  });

  test("a rule that the user types with the final sigma or the dotted capital I matches the folded address", () => {
    expect(matchSender("αννασ@acme.pl", [{ pattern: "αννας@acme.pl", kind: "whitelist" }]).whitelisted).toBe(true);
    expect(matchSender("ilker@acme.pl", [{ pattern: "İLKER@acme.pl", kind: "whitelist" }]).whitelisted).toBe(true);
  });

  test("another address does not match", () => {
    expect(matchSender("αννας@other.pl", [{ pattern: "αννασ@acme.pl", kind: "vip" }]).vip).toBe(false);
  });
});
