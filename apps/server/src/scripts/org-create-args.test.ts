import { UsageError } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { parseOrgCreateArgs } from "./org-create-args";

const required = ["--org-name", "Acme", "--email", "a@x.test", "--display-name", "Ann"];

describe("parseOrgCreateArgs", () => {
  test("the required three give a 30-day trial in Warsaw", () => {
    expect(parseOrgCreateArgs(required)).toEqual({
      orgName: "Acme",
      email: "a@x.test",
      displayName: "Ann",
      timezone: "Europe/Warsaw",
      plan: { kind: "trial", trialDays: 30 },
    });
  });

  test("an active plan and a chosen trial length", () => {
    expect(parseOrgCreateArgs([...required, "--plan", "active", "--timezone", "UTC"])).toMatchObject({
      timezone: "UTC",
      plan: { kind: "active" },
    });
    expect(parseOrgCreateArgs([...required, "--trial-days", "365"]).plan).toEqual({ kind: "trial", trialDays: 365 });
  });

  test.each([
    ["no arguments", []],
    ["no --org-name", ["--email", "a@x.test", "--display-name", "Ann"]],
    ["no --display-name", ["--org-name", "Acme", "--email", "a@x.test"]],
    ["an unknown plan", [...required, "--plan", "gold"]],
    ["an active plan with --trial-days", [...required, "--plan", "active", "--trial-days", "5"]],
    ["--trial-days 0", [...required, "--trial-days", "0"]],
    ["--trial-days 366", [...required, "--trial-days", "366"]],
    ["--trial-days abc", [...required, "--trial-days", "abc"]],
  ])("%s is a usage error", (_name, argv) => {
    expect(() => parseOrgCreateArgs(argv)).toThrow(UsageError);
  });

  test("an unknown flag throws a parse error that runCli maps to usage", () => {
    expect(() => parseOrgCreateArgs([...required, "--nope"])).toThrow(/--nope/);
  });
});
