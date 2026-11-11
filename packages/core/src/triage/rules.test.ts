import { describe, expect, test } from "bun:test";

import { classifierCategories } from "./categories";
import {
  applyHardRules,
  isNoreplyAddress,
  isValidSenderPattern,
  matchSender,
  normalizeSenderPattern,
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

  test("normalizes with trim and lower case", () => {
    expect(normalizeSenderPattern("  Boss@Firma.TEST ")).toBe("boss@firma.test");
  });
});
