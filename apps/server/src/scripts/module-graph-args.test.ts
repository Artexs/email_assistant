import { describe, expect, test } from "bun:test";

import { parseModuleGraphArgs } from "./module-graph-args";

describe("graph:modules arguments", () => {
  test("no argument parses", () => {
    expect(parseModuleGraphArgs([])).toBeUndefined();
  });

  test.each([["--no-such-flag"], ["extra"]])("%s is refused", (arg) => {
    expect(() => parseModuleGraphArgs([arg])).toThrow();
  });
});
