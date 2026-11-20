import { describe, expect, test } from "bun:test";

import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  test.each([
    ["/mailboxes", "/mailboxes"],
    ["/mailboxes?x=1", "/mailboxes?x=1"],
    ["/mailboxes?x=1#y", "/mailboxes?x=1#y"],
    [null, "/"],
    [undefined, "/"],
    ["", "/"],
    ["mailboxes", "/"],
    ["//evil.test", "/"],
    ["https://evil.test/", "/"],
    ["/\\evil.test", "/"],
    ["/login", "/"],
    ["/login?next=%2F", "/"],
    ["/setup?token=abc", "/"],
    ["/\t/evil.test", "/"],
    ["/\n/evil.test", "/"],
    ["/\r\n/evil.test", "/"],
    ["/%09/evil.test", "/%09/evil.test"],
    ["/.//evil.test", "/"],
    ["/..//evil.test", "/"],
    ["/a/..//evil.test", "/"],
    ["/%2e//evil.test", "/"],
  ])("%j -> %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("safeNextPath edges", () => {
  test.each([
    ["/x\u0007", "/"],
    ["/x\u001f", "/"],
    ["/x\u007f", "/"],
    ["/x ", "/x"],
    ["/x~", "/x~"],
    ["/x y", "/x%20y"],
    ["/loginx", "/"],
    ["/setup/x", "/"],
    ["a", "/"],
    ["/a?b#c", "/a?b#c"],
    ["/%2F%2Fevil", "/%2F%2Fevil"],
  ])("%j -> %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
