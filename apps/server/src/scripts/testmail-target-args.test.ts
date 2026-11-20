import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseTestmailTargetArgs } from "./testmail-target-args";

const ORG = "11111111-1111-4111-8111-111111111111";
const BOX = "22222222-2222-4222-8222-222222222222";
const ids = ["--org-id", ORG, "--mailbox-id", BOX];

describe("parseTestmailTargetArgs", () => {
  test("deliver takes --check-only; compare takes --bar and --min-kept; each has defaults", () => {
    expect(parseTestmailTargetArgs(["deliver", ...ids, "--check-only"])).toEqual({
      command: "deliver",
      orgId: ORG,
      mailboxId: BOX,
      checkOnly: true,
      bar: 0.98,
      minKept: 30,
    });
    expect(parseTestmailTargetArgs(["compare", ...ids, "--bar", "0.9", "--min-kept", "5"])).toEqual({
      command: "compare",
      orgId: ORG,
      mailboxId: BOX,
      checkOnly: false,
      bar: 0.9,
      minKept: 5,
    });
  });

  test.each([
    ["no subcommand", ids],
    ["an unknown subcommand", ["nope", ...ids]],
    ["a bad organization id", ["deliver", "--org-id", "x", "--mailbox-id", BOX]],
    ["no mailbox id", ["deliver", "--org-id", ORG]],
    ["compare with --check-only", ["compare", ...ids, "--check-only"]],
    ["deliver with --bar", ["deliver", ...ids, "--bar", "0.9"]],
    ["compare with a bar of 0", ["compare", ...ids, "--bar", "0"]],
  ])("%s throws a usage error", (_name, argv) => {
    expect(() => parseTestmailTargetArgs(argv)).toThrow(UsageError);
  });
});
