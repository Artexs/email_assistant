import { describe, expect, test } from "bun:test";

import { isTestAddress, parseTestAddresses } from "./test-address";

describe("TEST_MAILBOX_ADDRESS", () => {
  test("a list admits each address and refuses another one", () => {
    const raw = "a@x.test, b@x.test";
    expect(isTestAddress("a@x.test", raw)).toBe(true);
    expect(isTestAddress("b@x.test", raw)).toBe(true);
    expect(isTestAddress("c@x.test", raw)).toBe(false);
  });

  test("one address works as before, in any letter case and with spaces", () => {
    expect(isTestAddress("A@X.test", " a@x.test ")).toBe(true);
    expect(isTestAddress("a@x.test", "A@X.TEST")).toBe(true);
  });

  test("unset and empty admit nothing; a prefix or a part of an address is not a match", () => {
    expect(isTestAddress("a@x.test", undefined)).toBe(false);
    expect(isTestAddress("a@x.test", "")).toBe(false);
    expect(isTestAddress("", ",")).toBe(false);
    expect(isTestAddress("a@x.test", "aa@x.test,a@x.test.evil")).toBe(false);
  });

  test("parse drops empty entries and repeats", () => {
    expect(parseTestAddresses("a@x.test,, A@x.test ,b@x.test,")).toEqual(["a@x.test", "b@x.test"]);
  });
});
