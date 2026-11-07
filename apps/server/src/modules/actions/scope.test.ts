import { describe, expect, test } from "bun:test";

import { claimFilterFor, scopeAdmits } from "./scope";

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
