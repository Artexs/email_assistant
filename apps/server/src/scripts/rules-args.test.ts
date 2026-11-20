import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseRulesArgs } from "./rules-args";

const org = "11111111-1111-4111-8111-111111111111";
const mailbox = "22222222-2222-4222-8222-222222222222";

describe("parseRulesArgs", () => {
  test("add with the two required flags gives a typed value with a stored pattern", () => {
    expect(parseRulesArgs(["add", "--org-id", org, "--pattern", "Example.Test", "--kind", "whitelist"])).toEqual({
      command: "add",
      orgId: org,
      mailboxId: null,
      pattern: "example.test",
      kind: "whitelist",
    });
  });

  test("add and list take an optional mailbox id", () => {
    expect(
      parseRulesArgs(["add", "--org-id", org, "--mailbox-id", mailbox, "--pattern", "a@example.test", "--kind", "vip"])
    ).toMatchObject({ mailboxId: mailbox });
    expect(parseRulesArgs(["list", "--org-id", org, "--mailbox-id", mailbox])).toEqual({
      command: "list",
      orgId: org,
      mailboxId: mailbox,
    });
    expect(parseRulesArgs(["list", "--org-id", org])).toEqual({ command: "list", orgId: org, mailboxId: null });
  });

  test.each([
    ["an unknown kind", ["add", "--org-id", org, "--pattern", "example.test", "--kind", "nope"]],
    ["a missing kind", ["add", "--org-id", org, "--pattern", "example.test"]],
    ["a missing pattern", ["add", "--org-id", org, "--kind", "vip"]],
    [
      "a pattern with no local part and no domain",
      ["add", "--org-id", org, "--pattern", "@example.test", "--kind", "vip"],
    ],
    ["a pattern flag on list", ["list", "--org-id", org, "--pattern", "x"]],
    ["a kind flag on list", ["list", "--org-id", org, "--kind", "vip"]],
    ["a bad organization id", ["list", "--org-id", "x"]],
    ["a missing organization id", ["list"]],
    ["a bad mailbox id", ["list", "--org-id", org, "--mailbox-id", "x"]],
    ["an unknown subcommand", ["remove", "--org-id", org]],
    ["no subcommand", ["--org-id", org]],
    ["an unknown flag", ["list", "--org-id", org, "--no-such-flag"]],
  ])("%s is a usage error", (_label, argv) => {
    expect(() => parseRulesArgs(argv)).toThrow(UsageError);
  });
});
