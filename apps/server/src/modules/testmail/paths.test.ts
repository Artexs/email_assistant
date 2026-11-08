import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import { testmailPaths } from "./paths";

describe("testmailPaths", () => {
  test("TESTMAIL_ROOT puts every path under the root", () => {
    const paths = testmailPaths({ TESTMAIL_ROOT: "/tmp/x" });
    for (const path of [
      paths.batchesDir,
      paths.personasFile,
      paths.targetFile,
      paths.runsDir,
      paths.lockFile,
      paths.batchLog("b1"),
    ]) {
      expect(path.startsWith("/tmp/x/")).toBe(true);
    }
    expect(paths.lockFile).toBe("/tmp/x/evals/.runs/testmail/send.lock");
    expect(paths.batchLog("b1")).toBe("/tmp/x/evals/.runs/testmail/b1.jsonl");
  });

  test("without TESTMAIL_ROOT the runs folder is in the home state folder", () => {
    const paths = testmailPaths({});
    expect(paths.runsDir).toBe(join(homedir(), ".local/state/ea-testmail"));
    expect(paths.batchesDir.endsWith("evals/testmail/batches")).toBe(true);
    expect(paths.batchLog("b1")).toBe(join(paths.runsDir, "b1.jsonl"));
    const root = dirname(dirname(dirname(paths.batchesDir)));
    expect(existsSync(join(root, "package.json"))).toBe(true);
    expect(existsSync(join(root, "evals/cases"))).toBe(true);
  });

  test("an empty TESTMAIL_ROOT counts as unset", () => {
    expect(testmailPaths({ TESTMAIL_ROOT: "" })).toEqual(
      expect.objectContaining({ runsDir: join(homedir(), ".local/state/ea-testmail") })
    );
  });

  test("a relative TESTMAIL_ROOT throws", () => {
    expect(() => testmailPaths({ TESTMAIL_ROOT: "rel/dir" })).toThrow("absolute");
  });
});
