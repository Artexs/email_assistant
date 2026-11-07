import { describe, expect, test } from "bun:test";

import type { SendClaimFilter } from "./repo";
import { claimFilterFor, scopeAdmits, sendFilterFor, sendScopeAdmits } from "./scope";

describe("claimFilterFor", () => {
  test("off holds back every mailbox change", () => {
    expect(claimFilterFor({ kind: "off" }, "box@x.test")).toEqual({ kind: "none" });
  });

  test("synthetic applies to every mailbox", () => {
    expect(claimFilterFor({ kind: "synthetic" }, "box@x.test")).toEqual({ kind: "synthetic" });
  });

  test("all matches the test mailbox address in any case", () => {
    expect(claimFilterFor({ kind: "all", mailboxAddress: "Box@X.test" }, "box@x.TEST")).toEqual({ kind: "all" });
  });

  test("all gives no mailbox change in another mailbox", () => {
    expect(claimFilterFor({ kind: "all", mailboxAddress: "box@x.test" }, "other@x.test")).toEqual({ kind: "none" });
  });
});

describe("scopeAdmits", () => {
  const synthetic = "<a@ea-seed.test>";
  const real = "<a@real.test>";

  test("all admits every mail", () => {
    expect(scopeAdmits({ kind: "all" }, synthetic)).toBe(true);
    expect(scopeAdmits({ kind: "all" }, real)).toBe(true);
    expect(scopeAdmits({ kind: "all" }, null)).toBe(true);
  });

  test("synthetic admits only a synthetic Message-ID", () => {
    expect(scopeAdmits({ kind: "synthetic" }, synthetic)).toBe(true);
    expect(scopeAdmits({ kind: "synthetic" }, real)).toBe(false);
    expect(scopeAdmits({ kind: "synthetic" }, null)).toBe(false);
  });

  test("none admits nothing", () => {
    expect(scopeAdmits({ kind: "none" }, synthetic)).toBe(false);
    expect(scopeAdmits({ kind: "none" }, real)).toBe(false);
    expect(scopeAdmits({ kind: "none" }, null)).toBe(false);
  });
});

describe("sendFilterFor", () => {
  test("off holds back every send", () => {
    expect(sendFilterFor({ kind: "off" }, "box@x.test")).toEqual({ kind: "none" });
  });

  test("self keeps the address list in lower case", () => {
    expect(sendFilterFor({ kind: "self", addresses: ["Me@X.test", "b@x.test"] }, "box@x.test")).toEqual({
      kind: "self",
      addresses: ["me@x.test", "b@x.test"],
    });
  });

  test("all matches the test mailbox address in any case", () => {
    expect(sendFilterFor({ kind: "all", mailboxAddress: "Box@X.test" }, "box@x.TEST")).toEqual({ kind: "all" });
  });

  test("all sends nothing from another mailbox", () => {
    expect(sendFilterFor({ kind: "all", mailboxAddress: "box@x.test" }, "other@x.test")).toEqual({ kind: "none" });
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
