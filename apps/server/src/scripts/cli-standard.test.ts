import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cliDescriptionSchema, type CliDescription } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { readToolCommands } from "./lib/cli-tools";

// The standard of docs/cli.md, one test per tool command. A file in `cli-pending.json` is not converted yet: the list shrinks
// with each conversion stage and the file goes away at the last one.
const root = resolve(import.meta.dir, "../../../..");
const SPAWN_TIMEOUT_MS = 20_000;
const pending = JSON.parse(readFileSync(join(import.meta.dir, "cli-pending.json"), "utf8")) as Record<string, string[]>;
const pendingFiles = Object.values(pending).flat();
const commands = readToolCommands(root);

// Bun loads a `.env` of the working directory, also with an empty env: `--no-env-file` keeps the run free of it.
async function run(file: string, args: string[]) {
  const proc = Bun.spawn(["bun", "--no-env-file", file, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("cli standard: the tools that follow it", () => {
  const converted = commands.filter((command) => !pendingFiles.includes(command.file));

  test("at least one tool follows the standard", () => {
    expect(converted.map((command) => command.name)).toContain("cli:list");
  });

  for (const command of converted) {
    const argv = command.subcommand === undefined ? [] : [command.subcommand];

    describe(command.name, () => {
      test("the description matches the package.json name", async () => {
        const module = (await import(join(root, command.descriptionFile))) as {
          cliDescriptions?: readonly CliDescription[];
        };
        const description = module.cliDescriptions?.find((item) => item.name === command.name);
        expect(description).toBeDefined();
        expect(cliDescriptionSchema.safeParse(description).success).toBe(true);
        expect(description?.name).toBe(command.name);
        expect(description?.usage.split("\n")[0]).toStartWith(`bun run ${command.name}`);
        expect(description?.subcommand).toBe(command.subcommand);
      });

      test(
        "--help exits 0 and prints the summary",
        async () => {
          const module = (await import(join(root, command.descriptionFile))) as {
            cliDescriptions: readonly CliDescription[];
          };
          const summary = module.cliDescriptions.find((item) => item.name === command.name)?.summary ?? "";
          const result = await run(command.file, [...argv, "--help"]);
          expect(result.code).toBe(0);
          expect(result.stdout).toContain(summary);
        },
        SPAWN_TIMEOUT_MS
      );

      test(
        "an unknown flag exits 2 and prints the usage",
        async () => {
          const result = await run(command.file, [...argv, "--no-such-flag"]);
          expect(result.code).toBe(2);
          expect(result.stderr).toContain(`usage: bun run ${command.name}`);
        },
        SPAWN_TIMEOUT_MS
      );
    });
  }
});

describe("cli standard: the pending list", () => {
  const toolFiles = new Set(commands.map((command) => command.file));

  test("each pending file exists and is a tool file or a helper of scripts/lib/", () => {
    const bad = pendingFiles.filter(
      (file) =>
        !existsSync(join(root, file)) || !(toolFiles.has(file) || file.startsWith("apps/server/src/scripts/lib/"))
    );
    expect(bad).toEqual([]);
  });

  test("no file is pending twice", () => {
    expect(pendingFiles.filter((file, index) => pendingFiles.indexOf(file) !== index)).toEqual([]);
  });
});
