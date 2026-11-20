import { describe, expect, test } from "bun:test";

import { cleanUserText } from "./user-text";

describe("cleanUserText", () => {
  test.each([
    ["T1 line ends, controls and bidi", "Hi\r\nthere\u0007\u202E ok  \n", "Hi\nthere ok"],
    ["T3 only hidden characters", "\u2067\u0000  ", ""],
    ["T4 Polish letters stay", "Zażółć gęślą jaźń", "Zażółć gęślą jaźń"],
    ["the end of every line is trimmed, not only the end of the text", "a  \n \nb \t\nc", "a\n\nb\nc"],
    ["a lone CR is a line break, C1 and DEL go, tab stays in a body", "a\rb\u0085c\u007fd\te", "a\nbcd\te"],
  ])("%s", (_name, input, output) => {
    expect(cleanUserText(input, { oneLine: false })).toBe(output);
  });

  test("T2 one line", () => {
    expect(cleanUserText("Re:\n Budget\t2027 ", { oneLine: true })).toBe("Re: Budget 2027");
  });
});
