import { describe, expect, test } from "bun:test";

import { mapOutsideCode, stepFence, stripCodeSpans } from "./markdown-code";

describe("stepFence", () => {
  const run = (lines: string[]) => {
    let fence: string | null = null;
    return lines.map((line) => {
      const step = stepFence(fence, line);
      fence = step.fence;
      return step.code;
    });
  };
  test("a fence line and the lines inside are code; the closing fence ends it", () => {
    expect(run(["a", "```sh", "b", "```", "c"])).toEqual([false, true, true, true, false]);
  });
  test("a longer fence needs a closing fence as long; a tilde fence is not closed by backticks", () => {
    expect(run(["````", "```", "x", "````", "y"])).toEqual([true, true, true, true, false]);
    expect(run(["~~~", "```", "x", "~~~", "y"])).toEqual([true, true, true, true, false]);
  });
  test("an unclosed fence runs to the end", () => {
    expect(run(["```", "x", "y"])).toEqual([true, true, true]);
  });
});

describe("code spans", () => {
  test("stripCodeSpans removes balanced spans of any run length", () => {
    expect(stripCodeSpans("a `<b>` c ``d`e`` f")).toBe("a   c   f");
  });
  test("a span closes only with a run of its own length", () => {
    expect(stripCodeSpans("`a``b` c")).toBe("  c");
    expect(stripCodeSpans("``a`b`` c")).toBe("  c");
  });
  test("an unbalanced backtick stays in the text", () => {
    expect(stripCodeSpans("a ` <script>")).toBe("a ` <script>");
  });
  test("mapOutsideCode changes only the text between spans", () => {
    expect(mapOutsideCode("x `x` x", (text) => text.toUpperCase())).toBe("X `x` X");
    expect(mapOutsideCode("no code", (text) => `[${text}]`)).toBe("[no code]");
  });
});
