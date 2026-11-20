import { describe, expect, test } from "bun:test";

import { cutChars } from "./input";

describe("cutChars", () => {
  test.each([
    { name: "cuts after a surrogate pair without splitting it", text: "ab😀c", max: 3, out: "ab😀" },
    { name: "keeps a text of exactly the limit", text: "abc", max: 3, out: "abc" },
    { name: "cuts a text one over the limit", text: "abcd", max: 3, out: "abc" },
    { name: "counts a pair as one character at the limit", text: "ab😀", max: 3, out: "ab😀" },
    { name: "gives an empty text for a limit of 0", text: "abc", max: 0, out: "" },
  ])("$name", ({ text, max, out }) => {
    expect(cutChars(text, max)).toBe(out);
  });
});
