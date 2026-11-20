import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MINUTE_MS } from "@ea/core";
import { describe, expect, test } from "bun:test";

// Guard against the leak of `f097-sim-*` and `f116-sim-sent-*` folders in the temp dir. About 1,700 of them used the
// inodes of /tmp (a tmpfs) and test jobs then failed with `EDQUOT`.

const here = import.meta.dir;
const srcRoot = resolve(here, "../..");

const helpers = [
  { module: "sim-fixtures.test-helper", makers: ["createMiniCorpus", "completeCorpus"], remover: "removeAllCorpora" },
  {
    module: "sim-sent-fixtures.test-helper",
    makers: ["createSentCorpus", "completeSentCorpus"],
    remover: "removeAllSentCorpora",
  },
];

describe("temp folders of the sim fixtures", () => {
  test("every test file that makes a corpus calls the remover of its helper in afterAll", () => {
    const missing: string[] = [];
    for (const file of new Bun.Glob("**/*.test.ts").scanSync({ cwd: srcRoot })) {
      const text = readFileSync(join(srcRoot, file), "utf8");
      for (const helper of helpers) {
        if (!text.includes(`${helper.module}"`)) continue;
        const makes = helper.makers.some((maker) => new RegExp(`\\b${maker}\\(`).test(text));
        const removes = new RegExp(`afterAll\\(${helper.remover}\\)`).test(text);
        if (makes && !removes) missing.push(`${file}: no afterAll(${helper.remover})`);
      }
    }
    expect(missing).toEqual([]);
  });

  test(
    "a run of the helpers leaves no folder in the temp dir",
    () => {
      const scratch = mkdtempSync(join(tmpdir(), "tmp-leak-guard-"));
      try {
        const result = Bun.spawnSync(["bun", "test", join(here, "tmp-leak.fixture.ts")], {
          env: { ...process.env, TMPDIR: scratch },
        });
        const output = `${result.stdout.toString()}${result.stderr.toString()}`;
        expect(output).toContain("1 pass");
        expect(result.exitCode).toBe(0);
        expect(readdirSync(scratch)).toEqual([]);
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    MINUTE_MS
  );
});
