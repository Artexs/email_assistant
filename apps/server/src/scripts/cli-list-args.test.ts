import { cliDescriptionSchema } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { cliDescriptions, parseCliListArgs } from "./cli-list-args";

describe("parseCliListArgs", () => {
  test("no argument is the text table", () => {
    expect(parseCliListArgs([])).toEqual({ json: false });
  });

  test("--json is the JSON value", () => {
    expect(parseCliListArgs(["--json"])).toEqual({ json: true });
  });

  test.each([["--no-such-flag"], ["extra"], ["--json=x"]])("refuses %s", (arg) => {
    expect(() => parseCliListArgs([arg])).toThrow();
  });
});

describe("cliDescriptions", () => {
  test("the one description is valid", () => {
    expect(cliDescriptions.map((item) => cliDescriptionSchema.safeParse(item).success)).toEqual([true]);
  });
});
