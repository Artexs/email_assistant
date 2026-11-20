import { describe, expect, test } from "bun:test";

import { mailboxConnectOptions } from "./mailbox-connect-args";
import { mailboxPasswordOptions } from "./mailbox-password-args";
import { mailboxProbeOptions } from "./mailbox-probe-args";

// docs/cli.md § Arguments: a secret never comes from an argument. The three tools that take a password read it from stdin.
// `secret-kind` names the kind of the stored secret (password or app_password), not the secret.
const KIND_FLAGS = new Set(["secret-kind"]);
const SECRET_NAME = /password|passwd|secret|token|key/i;

describe("the mailbox tools that take a password", () => {
  test.each([
    ["mailbox:connect", mailboxConnectOptions],
    ["mailbox:password", mailboxPasswordOptions],
    ["mailbox:probe-move and mailbox:probe-send", mailboxProbeOptions],
  ])("%s has no option that carries a secret", (_name, options) => {
    const secretFlags = Object.keys(options).filter((flag) => SECRET_NAME.test(flag) && !KIND_FLAGS.has(flag));
    expect(secretFlags).toEqual([]);
  });

  test("the one allowed name, secret-kind, takes a kind and not a value (its default is password)", () => {
    expect(mailboxConnectOptions["secret-kind"].default).toBe("password");
  });
});
