import { describe, expect, test } from "bun:test";

import { claimFilterFor } from "./scope";

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
