import { describe, expect, test } from "bun:test";

import type { SendClaimFilter } from "./repo";
import { claimFilterFor, scopeAdmits, sendFilterFor, sendScopeAdmits } from "./scope";

const rule = { senders: ["t@a.test"] };

describe("claimFilterFor", () => {
  test("off holds back every mailbox change", () => {
    expect(claimFilterFor({ kind: "off" })).toEqual({ kind: "none" });
  });

  test("synthetic applies to every mailbox and keeps the test sender rule", () => {
    expect(claimFilterFor({ kind: "synthetic", testMail: rule })).toEqual({ kind: "synthetic", testMail: rule });
  });

  test("all gives `all` for every mailbox", () => {
    expect(claimFilterFor({ kind: "all" })).toEqual({ kind: "all" });
    expect(sendFilterFor({ kind: "all" })).toEqual({ kind: "all" });
  });
});

describe("scopeAdmits", () => {
  const synthetic = { messageIdHeader: "<a@ea-seed.test>", fromAddress: "boss@firma.test" };
  const real = { messageIdHeader: "<a@real.test>", fromAddress: "boss@firma.test" };
  const fromTestSender = { messageIdHeader: "<r@x.test>", fromAddress: "t@a.test" };
  const nothing = { messageIdHeader: null, fromAddress: null };

  test("all admits every mail", () => {
    expect(scopeAdmits({ kind: "all" }, synthetic)).toBe(true);
    expect(scopeAdmits({ kind: "all" }, real)).toBe(true);
    expect(scopeAdmits({ kind: "all" }, nothing)).toBe(true);
  });

  test("synthetic admits a synthetic Message-ID or a sender of the rule", () => {
    const filter = { kind: "synthetic", testMail: rule } as const;
    expect(scopeAdmits(filter, synthetic)).toBe(true);
    expect(scopeAdmits(filter, fromTestSender)).toBe(true);
    expect(scopeAdmits(filter, { ...fromTestSender, fromAddress: "T@A.test" })).toBe(true);
    expect(scopeAdmits(filter, real)).toBe(false);
    expect(scopeAdmits(filter, nothing)).toBe(false);
  });

  test("none admits nothing", () => {
    expect(scopeAdmits({ kind: "none" }, synthetic)).toBe(false);
    expect(scopeAdmits({ kind: "none" }, fromTestSender)).toBe(false);
    expect(scopeAdmits({ kind: "none" }, nothing)).toBe(false);
  });
});

describe("sendFilterFor", () => {
  test("off holds back every send", () => {
    expect(sendFilterFor({ kind: "off" })).toEqual({ kind: "none" });
  });

  test("self keeps the address list in lower case", () => {
    expect(sendFilterFor({ kind: "self", addresses: ["Me@X.test", "b@x.test"] })).toEqual({
      kind: "self",
      addresses: ["me@x.test", "b@x.test"],
    });
  });

  test("all admits every mailbox", () => {
    expect(sendFilterFor({ kind: "all" })).toEqual({ kind: "all" });
  });
});

describe("sendScopeAdmits", () => {
  test("all admits every recipient list", () => {
    expect(sendScopeAdmits({ kind: "all" }, ["a@x.test"])).toBe(true);
  });

  test("none admits nothing", () => {
    expect(sendScopeAdmits({ kind: "none" }, ["a@x.test"])).toBe(false);
    expect(sendScopeAdmits({ kind: "none" }, [])).toBe(false);
  });

  test("self admits when every recipient is in the list, in any case", () => {
    const filter: SendClaimFilter = { kind: "self", addresses: ["a@x.test", "b@x.test"] };
    expect(sendScopeAdmits(filter, ["A@X.test"])).toBe(true);
    expect(sendScopeAdmits(filter, ["a@x.test", "B@x.test"])).toBe(true);
    expect(sendScopeAdmits(filter, ["a@x.test", "c@x.test"])).toBe(false);
    expect(sendScopeAdmits(filter, ["c@x.test"])).toBe(false);
  });

  test("self admits no empty recipient list", () => {
    expect(sendScopeAdmits({ kind: "self", addresses: ["a@x.test"] }, [])).toBe(false);
  });
});
