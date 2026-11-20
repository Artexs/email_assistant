import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseMailboxPasswordArgs } from "./mailbox-password-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";
const ids = ["--org-id", org, "--mailbox-id", mailbox];

describe("parseMailboxPasswordArgs", () => {
  test("the ids keep the stored kind", () => {
    expect(parseMailboxPasswordArgs(ids)).toEqual({ orgId: org, mailboxId: mailbox, secretKind: undefined });
  });

  test("a secret kind", () => {
    expect(parseMailboxPasswordArgs([...ids, "--secret-kind", "app_password"])).toEqual({
      orgId: org,
      mailboxId: mailbox,
      secretKind: "app_password",
    });
  });

  test.each([
    ["a missing --mailbox-id", ["--org-id", org]],
    ["a kind that is not in the list", [...ids, "--secret-kind", "oauth"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseMailboxPasswordArgs(argv)).toThrow(UsageError);
  });

  test("a password as a flag is refused as an unknown option", () => {
    expect(() => parseMailboxPasswordArgs([...ids, "--password", "hunter2"])).toThrow(
      new UsageError("Unknown option '--password'")
    );
  });
});
