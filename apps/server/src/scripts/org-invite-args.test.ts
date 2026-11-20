import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgInviteArgs } from "./org-invite-args";

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

const required = ["--org-name", "Acme", "--email", "a@x.test", "--display-name", "Ann"];

describe("parseOrgInviteArgs", () => {
  test("the required three give the defaults", () => {
    expect(parseOrgInviteArgs(required)).toEqual({
      orgName: "Acme",
      email: "a@x.test",
      displayName: "Ann",
      locale: "pl",
      timezone: "Europe/Warsaw",
      trialDays: 30,
      print: false,
    });
  });

  test("all options are read", () => {
    const options = parseOrgInviteArgs([
      ...required,
      "--lang",
      "en",
      "--timezone",
      "UTC",
      "--trial-days",
      "365",
      "--print",
    ]);
    expect(options).toMatchObject({ locale: "en", timezone: "UTC", trialDays: 365, print: true });
  });

  test("bad input is a usage error", () => {
    expect(isUsageError(() => parseOrgInviteArgs([...required, "--lang", "de"]))).toBe(true);
    expect(isUsageError(() => parseOrgInviteArgs([...required, "--trial-days", "0"]))).toBe(true);
    expect(isUsageError(() => parseOrgInviteArgs([...required, "--trial-days", "366"]))).toBe(true);
    expect(isUsageError(() => parseOrgInviteArgs([...required, "--trial-days", "abc"]))).toBe(true);
    expect(isUsageError(() => parseOrgInviteArgs(["--org-name", "Acme", "--display-name", "Ann"]))).toBe(true);
    expect(isUsageError(() => parseOrgInviteArgs([...required, "--nope"]))).toBe(true);
  });
});
