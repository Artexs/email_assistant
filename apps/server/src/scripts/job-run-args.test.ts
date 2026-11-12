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

  test("rejects an unknown or missing name", () => {
    expect(parseJobRunArgs(["--name", "nope"])).toBeNull();
    expect(parseJobRunArgs([])).toBeNull();
    expect(parseJobRunArgs(["--name"])).toBeNull();
  });

  test("--force is for delegation.chaser only", () => {
    expect(parseJobRunArgs(["--name", "delegation.chaser", "--force"])).toEqual({
      name: "delegation.chaser",
      force: true,
    });
    expect(parseJobRunArgs(["--name", "actions.expiry", "--force"])).toBeNull();
  });

  test("rejects an unknown flag", () => {
    expect(parseJobRunArgs(["--name", "actions.expiry", "--now"])).toBeNull();
  });
});
