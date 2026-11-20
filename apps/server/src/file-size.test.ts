import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";

// The styleguide limit: a source file stays under about 400 lines (`docs/code-patterns.md` § Size and shape).
// These groups held a file that the quality pass 1 findings 4 to 7 named; each stays split. A new group is added when a split lands.
const LIMIT = 400;
const root = resolve(import.meta.dir, "../../..");
const groups: { name: string; pattern: string }[] = [
  { name: "mail sync", pattern: "apps/server/src/modules/mail/sync*.ts" },
  { name: "channels repo", pattern: "apps/server/src/modules/channels/repo/*.ts" },
  { name: "triage repo", pattern: "apps/server/src/modules/triage/repo/*.ts" },
  { name: "triage eval", pattern: "apps/server/src/modules/triage/eval*.ts" },
  { name: "platform config", pattern: "apps/server/src/platform/config*.ts" },
  { name: "actions send", pattern: "apps/server/src/modules/actions/send*.ts" },
  { name: "sim commands", pattern: "apps/server/src/scripts/lib/sim-*.ts" },
  { name: "texts", pattern: "apps/web/src/i18n/**/*.ts" },
];

function linesOf(file: string): number {
  return readFileSync(resolve(root, file), "utf8").split("\n").length - 1;
}

describe("file size", () => {
  for (const group of groups) {
    test(`${group.name}: no source file is over ${LIMIT} lines`, () => {
      const files = [...new Glob(group.pattern).scanSync({ cwd: root })].filter(
        (file) => !/\.test(-helper)?\.ts$|\.test-helper\.ts$/.test(file)
      );
      expect(files.length).toBeGreaterThan(0);
      const over = files.map((file) => ({ file, lines: linesOf(file) })).filter((entry) => entry.lines > LIMIT);
      expect(over).toEqual([]);
    });
  }
});
