import { describe, expect, test } from "bun:test";

import { parseCredentialsCheckArgs } from "./credentials-check-args";

describe("parseCredentialsCheckArgs", () => {
  test("no argument parses", () => {
    expect(parseCredentialsCheckArgs([])).toBeUndefined();
  });

  test.each([["extra"], ["--force"]])("the argument %p throws a parse error that runCli maps to exit 2", (arg) => {
    expect(() => parseCredentialsCheckArgs([arg])).toThrow(
      expect.objectContaining({ code: expect.stringMatching(/^ERR_PARSE_ARGS_/) })
    );
  });
});
