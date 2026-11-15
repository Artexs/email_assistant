import { describe, expect, test } from "bun:test";

import { cleanUserText } from "./user-text";

describe("cleanUserText", () => {
  test("T1 line ends, controls and bidi", () => {
    expect(cleanUserText("Hi\r\nthere\u0007\u202E ok  \n", { oneLine: false })).toBe("Hi\nthere ok");
  });

  test("T2 one line", () => {
    expect(cleanUserText("Re:\n Budget\t2027 ", { oneLine: true })).toBe("Re: Budget 2027");
  });

  test("T3 only hidden characters", () => {
    expect(cleanUserText("\u2067\u0000  ", { oneLine: false })).toBe("");
  });

  test("T4 Polish letters stay", () => {
    expect(cleanUserText("Zażółć gęślą jaźń", { oneLine: false })).toBe("Zażółć gęślą jaźń");
  });

  test("the end of every line is trimmed, not only the end of the text", () => {
    expect(cleanUserText("a  \n \nb \t\nc", { oneLine: false })).toBe("a\n\nb\nc");
  });

  test("a lone CR is a line break, C1 and DEL go, tab stays in a body", () => {
    expect(cleanUserText("a\rb\u0085c\u007fd\te", { oneLine: false })).toBe("a\nbcd\te");
  });
});
