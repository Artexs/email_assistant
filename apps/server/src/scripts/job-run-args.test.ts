import { describe, expect, test } from "bun:test";

import { parseJobRunArgs } from "./job-run-args";

describe("parseJobRunArgs", () => {
  test("parses a job name", () => {
    expect(parseJobRunArgs(["--name", "actions.expiry"])).toEqual({ name: "actions.expiry", force: false });
    expect(parseJobRunArgs(["--name", "actions.committer"])).toEqual({ name: "actions.committer", force: false });
    expect(parseJobRunArgs(["--name", "channels.notifier"])).toEqual({ name: "channels.notifier", force: false });
  });

  test("parses platform.retention and refuses --force for it", () => {
    expect(parseJobRunArgs(["--name", "platform.retention"])).toEqual({ name: "platform.retention", force: false });
    expect(parseJobRunArgs(["--name", "platform.retention", "--force"])).toBeNull();
  });

  test("parses loops.analyze and refuses --force for it", () => {
    expect(parseJobRunArgs(["--name", "loops.analyze"])).toEqual({ name: "loops.analyze", force: false });
    expect(parseJobRunArgs(["--name", "loops.analyze", "--force"])).toBeNull();
  });

  test("parses loops.match and refuses --force for it", () => {
    expect(parseJobRunArgs(["--name", "loops.match"])).toEqual({ name: "loops.match", force: false });
    expect(parseJobRunArgs(["--name", "loops.match", "--force"])).toBeNull();
  });

  test("rejects an unknown or missing name", () => {
    expect(parseJobRunArgs(["--name", "nope"])).toBeNull();
    expect(parseJobRunArgs([])).toBeNull();
    expect(parseJobRunArgs(["--name"])).toBeNull();
  });

  test("--force is for the chaser (loops.chaser and its alias delegation.chaser) only", () => {
    expect(parseJobRunArgs(["--name", "loops.chaser", "--force"])).toEqual({ name: "loops.chaser", force: true });
    expect(parseJobRunArgs(["--name", "delegation.chaser", "--force"])).toEqual({
      name: "delegation.chaser",
      force: true,
    });
    expect(parseJobRunArgs(["--name", "loops.chaser"])).toEqual({ name: "loops.chaser", force: false });
    expect(parseJobRunArgs(["--name", "actions.expiry", "--force"])).toBeNull();
  });

  // The name is compared as a whole string: a quoted, encoded or look-alike form is a usage error, not a job.
  test.each([
    ['"loops.chaser"', "quoted"],
    ["'loops.chaser'", "single quoted"],
    ["loops.chaser ", "trailing space"],
    [" loops.chaser", "leading space"],
    ["loops.chaser\n", "newline"],
    ["Loops.Chaser", "upper case"],
    ["loops%2Echaser", "percent encoded dot"],
    ["loops\\u002echaser", "escaped dot as text"],
    ["loops\u2024chaser", "one dot leader"],
    ["loops\uff0echaser", "full-width dot"],
    ["l\u043eops.chaser", "Cyrillic o"],
    ["loops.chaser\u200b", "zero-width space"],
    ["loops.chaser,delegation.chaser", "two names"],
    ["loops.chase", "prefix"],
  ])("refuses the name %j (%s)", (name) => {
    expect(parseJobRunArgs(["--name", name])).toBeNull();
    expect(parseJobRunArgs(["--name", name, "--force"])).toBeNull();
  });

  test("refuses a second name, a stray word and the equals form with a space", () => {
    expect(parseJobRunArgs(["--name", "loops.chaser", "--name", "actions.expiry"])).toEqual({
      name: "actions.expiry",
      force: false,
    });
    expect(parseJobRunArgs(["--name", "loops.chaser", "now"])).toBeNull();
    expect(parseJobRunArgs(["--name=loops.chaser"])).toEqual({ name: "loops.chaser", force: false });
    expect(parseJobRunArgs(["--name= loops.chaser"])).toBeNull();
    expect(parseJobRunArgs(["--force", "--name", "loops.chaser", "--force"])).toEqual({
      name: "loops.chaser",
      force: true,
    });
  });

  test("rejects an unknown flag", () => {
    expect(parseJobRunArgs(["--name", "actions.expiry", "--now"])).toBeNull();
  });
});
