import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgMemberArgs } from "./org-member-args";

// A usage error: a `UsageError` of the parser, or a `parseArgs` error (unknown flag, missing value), which `runCli` maps to exit 2 as well.
function isUsageError(run: () => unknown): boolean {
  try {
    run();
  } catch (error) {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    return error instanceof UsageError || (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_"));
  }
  return false;
}

const orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";
const userId = "6f1b1f0e-9d3a-4c55-8f02-7a9d1c2b3e44";

describe("parseOrgMemberArgs", () => {
  test("add: defaults and every option", () => {
    expect(
      parseOrgMemberArgs(["--org-id", orgId, "--add", "--email", " Eve@X.test ", "--display-name", "Eve"])
    ).toEqual({
      kind: "add",
      orgId,
      email: "Eve@X.test",
      displayName: "Eve",
      role: "assistant",
      locale: "pl",
    });
    expect(
      parseOrgMemberArgs([
        "--org-id",
        orgId,
        "--add",
        "--email",
        "eve@x.test",
        "--display-name",
        "Eve",
        "--role",
        "owner",
        "--lang",
        "en",
      ])
    ).toMatchObject({ kind: "add", role: "owner", locale: "en" });
  });

  test("end sessions, with and without --only-sso; unlink", () => {
    expect(parseOrgMemberArgs(["--org-id", orgId, "--user-id", userId, "--end-sessions"])).toEqual({
      kind: "end_sessions",
      orgId,
      userId,
      onlySso: false,
    });
    expect(parseOrgMemberArgs(["--org-id", orgId, "--user-id", userId, "--end-sessions", "--only-sso"])).toEqual({
      kind: "end_sessions",
      orgId,
      userId,
      onlySso: true,
    });
    expect(parseOrgMemberArgs(["--org-id", orgId, "--user-id", userId, "--unlink-sso"])).toEqual({
      kind: "unlink_sso",
      orgId,
      userId,
    });
  });

  test("bad input is a usage error", () => {
    const add = ["--org-id", orgId, "--add", "--display-name", "Eve"];
    const bad = [
      [],
      ["--org-id", orgId],
      // --add without --email, with a bad e-mail, without a name
      add,
      [...add, "--email", "no-at-sign"],
      [...add, "--email", "a@b"],
      [...add, "--email", "a b@x.test"],
      ["--org-id", orgId, "--add", "--email", "eve@x.test"],
      ["--org-id", orgId, "--add", "--email", "eve@x.test", "--display-name", "  "],
      // a bad role or language
      [...add, "--email", "eve@x.test", "--role", "admin"],
      [...add, "--email", "eve@x.test", "--lang", "de"],
      // a non-UUID id
      ["--org-id", "nope", "--user-id", userId, "--end-sessions"],
      ["--org-id", orgId, "--user-id", "nope", "--end-sessions"],
      // no user id, no organization
      ["--org-id", orgId, "--end-sessions"],
      ["--user-id", userId, "--end-sessions"],
      // two commands
      ["--org-id", orgId, "--user-id", userId, "--end-sessions", "--unlink-sso"],
      [...add, "--email", "eve@x.test", "--end-sessions", "--user-id", userId],
      // options of another command
      ["--org-id", orgId, "--user-id", userId, "--unlink-sso", "--only-sso"],
      ["--org-id", orgId, "--user-id", userId, "--end-sessions", "--role", "owner"],
      [...add, "--email", "eve@x.test", "--user-id", userId],
      [...add, "--email", "eve@x.test", "--only-sso"],
      // unknown option, positional
      ["--org-id", orgId, "--user-id", userId, "--end-sessions", "--all"],
      ["--org-id", orgId, "--user-id", userId, "--end-sessions", "now"],
    ];
    for (const argv of bad)
      expect({ argv, usage: isUsageError(() => parseOrgMemberArgs(argv)) }).toEqual({ argv, usage: true });
  });
});
