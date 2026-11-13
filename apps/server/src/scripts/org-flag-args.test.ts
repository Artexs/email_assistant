import { describe, expect, test } from "bun:test";

import { parseOrgFlagArgs } from "./org-flag-args";

const orgId = "0b0f3b3e-6f1c-4d57-9d0e-3f0a8f6f2a11";

describe("parseOrgFlagArgs", () => {
  test("list mode", () => {
    expect(parseOrgFlagArgs(["--org-id", orgId])).toEqual({ mode: "list", orgId });
  });

  test("set mode, on and off", () => {
    expect(parseOrgFlagArgs(["--org-id", orgId, "--flag", "stats_page", "--on"])).toEqual({
      mode: "set",
      orgId,
      flag: "stats_page",
      enabled: true,
    });
    expect(parseOrgFlagArgs(["--org-id", orgId, "--flag", "stats_page", "--off"])).toEqual({
      mode: "set",
      orgId,
      flag: "stats_page",
      enabled: false,
    });
  });

  test("bad input gives null", () => {
    const bad = [
      [],
      ["--org-id", "nope"],
      ["--org-id", orgId, "--flag", "stats_page", "--on", "--off"],
      ["--org-id", orgId, "--flag", "stats_page"],
      ["--org-id", orgId, "--on"],
      ["--org-id", orgId, "--flag", "", "--on"],
      ["--org-id", orgId, "extra"],
      ["--org-id", orgId, "--unknown", "x"],
    ];
    for (const argv of bad) expect(parseOrgFlagArgs(argv)).toBeNull();
  });
});
