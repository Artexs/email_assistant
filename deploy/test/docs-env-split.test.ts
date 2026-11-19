import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// Stage 03 of the production-on-the-VPS ticket: the runbooks teach the split host (ADR 0019) and no secret copy.
// The test reads the tracked files of the repo; it needs no .env file and no Docker.

const ROOT = join(import.meta.dir, "..", "..");

function tracked(...paths: string[]): string[] {
  const result = Bun.spawnSync(["git", "ls-files", ...paths], { cwd: ROOT });
  expect(result.exitCode).toBe(0);
  return result.stdout
    .toString()
    .split("\n")
    .filter((name) => name !== "");
}

// Operator-facing text: deploy/ (not its tests) and docs/ (not the ADR history and not the owner decision log, which only the coordinator writes).
const operatorFiles = (): string[] =>
  tracked("deploy", "docs").filter(
    (name) =>
      !name.startsWith("deploy/test/") &&
      !name.startsWith("docs/decisions/") &&
      name !== "docs/owner-decisions.md" &&
      /\.(md|sh|ya?ml|example)$/.test(name)
  );

interface Hit {
  file: string;
  line: string;
}

function lineHits(files: string[], match: (line: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
      if (match(line)) hits.push({ file, line });
    }
  }
  return hits;
}

describe("runbooks of the split host", () => {
  test("3. `--env-file .env` stays only on the one line that names the old form", () => {
    const hits = lineHits(operatorFiles(), (line) => /--env-file \.env(?![\w./-])/.test(line));
    expect(hits.map((hit) => hit.file)).toEqual(["deploy/README.md"]);
    expect(hits[0]?.line).toContain("was not split yet");
  });

  test("the C= line of the README uses deploy/db.env", () => {
    const hits = lineHits(["deploy/README.md"], (line) => line.startsWith("C="));
    expect(hits.map((hit) => hit.line)).toEqual(['C="docker compose -f deploy/compose.yaml --env-file deploy/db.env"']);
  });

  test("every cron line of the README that runs Compose reads deploy/db.env", () => {
    const hits = lineHits(["deploy/README.md"], (line) => /`\d+ \S+ \S+ \S+ \S+ .*docker compose/.test(line));
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.line).toContain("--env-file deploy/db.env");
  });

  test("4. no document makes or restores a copy of .env", () => {
    const hits = lineHits(operatorFiles(), (line) => /\.env\.bak/.test(line));
    expect(hits).toEqual([]);
  });

  test("no document migrates through the cli service: the one-off service migrate does it", () => {
    const hits = lineHits(operatorFiles(), (line) => /run (--build )?--rm (-T )?cli bun run db:migrate/.test(line));
    expect(hits).toEqual([]);
  });

  test("the README has the section Env split with the tool names", () => {
    const readme = readFileSync(join(ROOT, "deploy/README.md"), "utf8");
    expect(readme).toContain("\n## Env split (an existing host)\n");
    for (const name of [
      "deploy/env-split.sh",
      "env-split.sh --undo",
      "deploy/check-server-env.sh",
      "ea_env_split_state",
    ]) {
      expect(readme).toContain(name);
    }
  });
});

describe("ADR 0019", () => {
  test("is accepted in the file and in the list", () => {
    const adr = readFileSync(join(ROOT, "docs/decisions/0019-production-on-the-home-vps.md"), "utf8");
    expect(adr).toMatch(/^- Status: accepted/m);
    const row = lineHits(["docs/decisions/README.md"], (line) => line.startsWith("| 0019 |"));
    expect(row).toHaveLength(1);
    expect(row[0]?.line).toContain("accepted");
    expect(row[0]?.line).not.toContain("reserved");
  });
});
