import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { cliListSchema } from "../cli-list-args";

import { loadToolRows, readToolCommands } from "./cli-tools";

const repoRoot = resolve(import.meta.dir, "../../../../..");
const roots: string[] = [];

function tempRoot(scripts: Record<string, string>, files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cli-tools-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

const descriptionOf = (name: string) =>
  `export const cliDescriptions = [{ name: ${JSON.stringify(name)}, summary: "Does it.", risk: "read", needs: ["none"], usage: "bun run ${name}" }];\n`;

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("readToolCommands", () => {
  test("keeps the scripts that run a tool file and drops the rest", () => {
    const root = tempRoot({
      "a:x": "bun apps/server/src/scripts/a.ts",
      "b:y": "bun apps/server/src/scripts/b.ts add",
      lint: "eslint .",
      "test:unit": "bun test tools/fake-telegram/src",
    });
    expect(readToolCommands(root)).toEqual([
      { name: "a:x", file: "apps/server/src/scripts/a.ts", descriptionFile: "apps/server/src/scripts/a-args.ts" },
      {
        name: "b:y",
        file: "apps/server/src/scripts/b.ts",
        subcommand: "add",
        descriptionFile: "apps/server/src/scripts/b-args.ts",
      },
    ]);
  });

  test("takes a tool under tools/<x>/src and names its description file cli-args.ts", () => {
    const root = tempRoot({ "fake-tg": "bun tools/fake-telegram/src/cli.ts" });
    expect(readToolCommands(root)).toEqual([
      {
        name: "fake-tg",
        file: "tools/fake-telegram/src/cli.ts",
        descriptionFile: "tools/fake-telegram/src/cli-args.ts",
      },
    ]);
  });

  test("throws with the script name when more than one word follows the file", () => {
    const root = tempRoot({ "c:z": "bun apps/server/src/scripts/c.ts --flag" });
    expect(() => readToolCommands(root)).toThrow("c:z");
  });
});

describe("loadToolRows", () => {
  test("a tool whose entry file is absent is not available and not missing", async () => {
    const root = tempRoot({ "t:cli": "bun tools/t/src/cli.ts" });
    const { rows, missing } = await loadToolRows(root);
    expect(missing).toEqual([]);
    expect(rows.map((row) => [row.name, row.available])).toEqual([["t:cli", false]]);
  });

  test("a description file with no item named as the command puts the name in missing", async () => {
    const root = tempRoot(
      { "a:x": "bun apps/server/src/scripts/a.ts" },
      { "apps/server/src/scripts/a.ts": "", "apps/server/src/scripts/a-args.ts": descriptionOf("a:other") }
    );
    const { rows, missing } = await loadToolRows(root);
    expect(missing).toEqual(["a:x"]);
    expect(rows).toEqual([]);
  });

  test("a tool with no description yet gets a placeholder row at the safest risk", async () => {
    const root = tempRoot(
      { "a:x": "bun apps/server/src/scripts/a.ts", "b:y": "bun apps/server/src/scripts/b.ts" },
      {
        "apps/server/src/scripts/a.ts": "",
        "apps/server/src/scripts/b.ts": "",
        "apps/server/src/scripts/b-args.ts": "export const other = 1;\n",
      }
    );
    const { rows, missing } = await loadToolRows(root);
    expect(missing).toEqual([]);
    expect(rows.map((row) => [row.name, row.summary, row.risk, row.available])).toEqual([
      ["a:x", "(no description yet)", "danger", true],
      ["b:y", "(no description yet)", "danger", true],
    ]);
  });

  test("a described tool keeps its description and gains its file", async () => {
    const root = tempRoot(
      { "a:x": "bun apps/server/src/scripts/a.ts" },
      { "apps/server/src/scripts/a.ts": "", "apps/server/src/scripts/a-args.ts": descriptionOf("a:x") }
    );
    const { rows } = await loadToolRows(root);
    expect(rows).toEqual([
      {
        name: "a:x",
        summary: "Does it.",
        risk: "read",
        needs: ["none"],
        usage: "bun run a:x",
        file: "apps/server/src/scripts/a.ts",
        available: true,
      },
    ]);
  });
});

describe("cli:list", () => {
  test("with no env it exits 0 and prints one row per tool command as JSON", async () => {
    const proc = Bun.spawn(["bun", "--no-env-file", "apps/server/src/scripts/cli-list.ts", "--json"], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const list = cliListSchema.parse(JSON.parse(stdout));
    expect(list.tools.map((tool) => tool.name).sort()).toEqual(
      readToolCommands(repoRoot)
        .map((command) => command.name)
        .sort()
    );
  }, 20_000);
});
