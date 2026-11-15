import { describe, expect, test } from "bun:test";

import { assertSafeEvidence, EvidenceRefusal, maskAddresses, word } from "./redact";

const refusedRule = (evidence: unknown): string | undefined => {
  try {
    assertSafeEvidence(evidence);
    return undefined;
  } catch (error) {
    return error instanceof EvidenceRefusal ? error.rule : "other error";
  }
};

describe("assertSafeEvidence", () => {
  test("refuses each token shape and an address", () => {
    const cases: [string, string][] = [
      ["bearer eyJhbGciOiJSUzI1NiJ9", "jwt"],
      ["token ya29.a0AfH6SMB", "google-access-token"],
      ["refresh 1//0gAbCdEfGh", "google-refresh-token"],
      ["refresh=M.C507_BAY.0.U.-Cq", "microsoft-refresh-token"],
      ["M.C", "microsoft-refresh-token"],
      ["access EwBwA8l6BAAU", "microsoft-access-token"],
      [`run ${"a1_-".repeat(10)}`, "long-token-run"],
      [`run ${"A".repeat(40)}`, "long-token-run"],
      ["mailbox boss@x.test", "address"],
      ["only an @ sign", "address"],
    ];
    for (const [evidence, rule] of cases) expect(refusedRule(evidence)).toBe(rule);
  });

  test("refuses a value that is not a string, and a string that is too long", () => {
    expect(refusedRule(undefined)).toBe("not-a-string");
    expect(refusedRule({ evidence: "ok" })).toBe("not-a-string");
    expect(refusedRule(`${"word ".repeat(500)}`)).toBe("too-long");
  });

  test("the refusal names the rule and never holds the refused text", () => {
    try {
      assertSafeEvidence("secret eyJhbGciOiJSUzI1NiJ9 boss@x.test");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceRefusal);
      expect(String(error)).not.toContain("eyJ");
      expect(String(error)).not.toContain("boss");
    }
  });

  test("accepts the evidence a row writes", () => {
    const accepted = [
      "AUTH=XOAUTH2 UIDPLUS MOVE",
      "AADSTS65001",
      "202",
      "Sent Items",
      "granted scope https://outlook.office.com/IMAP.AccessAsUser.All https://graph.microsoft.com/Mail.Send openid",
      "granted scope https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email",
      "CAPABILITY: IMAP4rev1 AUTH=XOAUTH2 MOVE | LIST: [Gmail]/Sent Mail \\Sent | AI/Spike -",
      `run ${"a".repeat(39)}`,
      "mail of <owner>",
      "query names: admin_consent state tenant",
    ];
    for (const evidence of accepted) expect(refusedRule(evidence)).toBeUndefined();
  });
});

describe("maskAddresses", () => {
  test("replaces a known address and its plus forms with <owner>", () => {
    const masked = maskAddresses("from Boss@X.test, to boss+ea-spike@x.test and other@x.test", ["boss@x.test"]);
    expect(masked).toBe("from <owner>, to <owner> and other@x.test");
  });
});

describe("word", () => {
  test("quotes a short plain word and hides everything else", () => {
    expect(word("AUTHENTICATIONFAILED")).toBe("AUTHENTICATIONFAILED");
    expect(word("boss@x.test")).toBe("?");
    expect(word("a".repeat(41))).toBe("?");
    expect(word(5)).toBe("?");
  });
});
