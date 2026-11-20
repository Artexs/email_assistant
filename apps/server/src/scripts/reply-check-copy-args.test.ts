import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { cliDescriptions, readCheckCopyOptions } from "./reply-check-copy-args";

const org = "11111111-1111-4111-8111-111111111111";
const action = "22222222-2222-4222-8222-222222222222";

describe("readCheckCopyOptions", () => {
  test("both ids", () => {
    expect(readCheckCopyOptions(["--org-id", org, "--action-id", action])).toEqual({ orgId: org, actionId: action });
  });

  test("a missing, bad or extra argument is a usage error", () => {
    expect(() => readCheckCopyOptions(["--action-id", action])).toThrow(UsageError);
    expect(() => readCheckCopyOptions(["--org-id", org])).toThrow(UsageError);
    expect(() => readCheckCopyOptions(["--org-id", "x", "--action-id", action])).toThrow(UsageError);
    expect(() => readCheckCopyOptions(["--org-id", org, "--action-id", "not-a-uuid"])).toThrow(UsageError);
    expect(() => readCheckCopyOptions(["--org-id", org, "--action-id", action, "--write"])).toThrow(UsageError);
  });

  const usage = cliDescriptions[0]?.usage ?? "";

  test("the usage names the four words, says it never writes to the mailbox or a row, and names the OAuth token write", () => {
    for (const word of [
      "same",
      "changed",
      "missing",
      "no_baseline",
      "never writes to the mailbox and never changes a",
      "refresh",
    ]) {
      expect(usage).toContain(word);
    }
    expect(usage).not.toContain("or the database");
  });
});
