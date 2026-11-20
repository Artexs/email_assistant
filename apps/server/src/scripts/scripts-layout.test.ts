import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { readToolCommands } from "./lib/cli-tools";

// A folder listing of `scripts/` is the tool list: a top-level file is a tool entry or the `<entry>-args.ts` of one, and every helper sits in `lib/`
// (`docs/cli.md`, the layout rule). A tool command is a root `package.json` script that runs `bun <file>.ts` under `apps/server/src/scripts/`.
const root = resolve(import.meta.dir, "../../../..");
const SCRIPTS = "apps/server/src/scripts/";
const toolFiles = new Set(
  readToolCommands(root)
    .filter((command) => command.file.startsWith(SCRIPTS))
    .map((command) => command.file.slice(SCRIPTS.length))
);
const argsFileOf = (file: string) => file.replace(/\.ts$/, "-args.ts");
const isTest = (file: string) => /\.test(-helper)?\.ts$/.test(file);

describe("scripts layout", () => {
  test("every top-level file of scripts/ is a tool entry or the args file of one", () => {
    const allowed = new Set([...toolFiles, ...[...toolFiles].map(argsFileOf)]);
    const top = readdirSync(import.meta.dir).filter((file) => file.endsWith(".ts") && !isTest(file));
    expect(top.filter((file) => !allowed.has(file))).toEqual([]);
  });

  test("every tool command names an existing file", () => {
    expect(toolFiles.size).toBeGreaterThan(0);
    expect([...toolFiles].filter((file) => !existsSync(join(import.meta.dir, file)))).toEqual([]);
  });

  test("no file of scripts/lib/ is a tool command", () => {
    const lib = readdirSync(join(import.meta.dir, "lib")).filter((file) => file.endsWith(".ts"));
    expect(lib.length).toBeGreaterThan(0);
    expect(lib.filter((file) => toolFiles.has(`lib/${file}`))).toEqual([]);
  });
});
