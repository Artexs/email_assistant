import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { prepareDemoRun } from "./prepare";

// The refusals come before a gate copy, a plan file or a replay server exists: the work folder stays empty.
const dir = mkdtempSync(join(tmpdir(), "demo-prepare-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("prepareDemoRun refusals", () => {
  test("a seed file that is not there is seed_missing", async () => {
    expect(await prepareDemoRun(join(dir, "none.json"), dir)).toBe("seed_missing");
  });

  test("a seed file that is not JSON is demo_seed_invalid bad_format, and nothing is written", async () => {
    const seed = join(dir, "bad.json");
    writeFileSync(seed, "not json");
    expect(await prepareDemoRun(seed, dir)).toBe("demo_seed_invalid bad_format");
    expect(readdirSync(dir).sort()).toEqual(["bad.json"]);
  });
});
