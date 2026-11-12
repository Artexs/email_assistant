import { describe, expect, test } from "bun:test";

import type { SendClaimFilter } from "./repo";
import { claimFilterFor, scopeAdmits, sendFilterFor, sendScopeAdmits } from "./scope";

describe("claimFilterFor", () => {
  test("off holds back every mailbox change", () => {
    expect(claimFilterFor({ kind: "off" })).toEqual({ kind: "none" });
  });

  test("synthetic applies to every mailbox", () => {
    expect(claimFilterFor({ kind: "synthetic" })).toEqual({ kind: "synthetic" });
  });

  test("all gives `all` for every mailbox", () => {
    expect(claimFilterFor({ kind: "all" })).toEqual({ kind: "all" });
    expect(sendFilterFor({ kind: "all" })).toEqual({ kind: "all" });
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
