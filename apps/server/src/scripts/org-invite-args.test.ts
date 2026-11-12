import { describe, expect, test } from "bun:test";

import { parseOrgInviteArgs } from "./org-invite-args";

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

  test("bad input gives undefined", () => {
    expect(parseOrgInviteArgs([...required, "--lang", "de"])).toBeUndefined();
    expect(parseOrgInviteArgs([...required, "--trial-days", "0"])).toBeUndefined();
    expect(parseOrgInviteArgs([...required, "--trial-days", "366"])).toBeUndefined();
    expect(parseOrgInviteArgs([...required, "--trial-days", "abc"])).toBeUndefined();
    expect(parseOrgInviteArgs(["--org-name", "Acme", "--display-name", "Ann"])).toBeUndefined();
    expect(parseOrgInviteArgs([...required, "--nope"])).toBeUndefined();
  });
});
