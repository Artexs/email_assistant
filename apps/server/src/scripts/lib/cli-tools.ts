import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CliDescription } from "@ea/core";

/** A `package.json` script that runs a tool. Paths are relative to the root. */
export interface ToolCommand {
  name: string;
  file: string;
  subcommand?: string;
  descriptionFile: string;
}

export type CliToolRowFull = CliDescription & { file: string; available: boolean };

const TOOL_FILE = /^(?:apps\/server\/src\/scripts\/[^/]+|tools\/[^/]+\/src\/[^/]+)\.ts$/;
const NO_DESCRIPTION = "(no description yet)";

// Unknown risk is the safest class until the tool has a description: an agent asks before it runs the tool.
const PLACEHOLDER_RISK = "danger";

/** The tool commands of the root `package.json`: `bun <file>.ts [subcommand]` under `apps/server/src/scripts/` or `tools/<x>/src/`. */
export function readToolCommands(rootDir: string): ToolCommand[] {
  const manifest = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const commands: ToolCommand[] = [];
  for (const [name, script] of Object.entries(manifest.scripts ?? {})) {
    const [runner, file, ...rest] = script.trim().split(/\s+/);
    if (runner !== "bun" || file === undefined || !TOOL_FILE.test(file)) {
      continue;
    }
    if (rest.length > 1 || rest[0]?.startsWith("-")) {
      throw new Error(
        `package.json script ${name}: a tool command is "bun <file>.ts" with at most one subcommand word, got "${script}"`
      );
    }
    commands.push({
      name,
      file,
      ...(rest[0] === undefined ? {} : { subcommand: rest[0] }),
      descriptionFile: file.replace(/\.ts$/, "-args.ts"),
    });
  }
  return commands;
}

/** One row per tool command. `missing` names the commands whose description file has no item of that name. */
export async function loadToolRows(rootDir: string): Promise<{ rows: CliToolRowFull[]; missing: string[] }> {
  const loaded = new Map<string, Promise<readonly CliDescription[] | null>>();
  const load = (descriptionFile: string) => {
    let pending = loaded.get(descriptionFile);
    if (pending === undefined) {
      pending = existsSync(join(rootDir, descriptionFile))
        ? import(join(rootDir, descriptionFile)).then(
            (module: { cliDescriptions?: readonly CliDescription[] }) => module.cliDescriptions ?? null
          )
        : Promise.resolve(null);
      loaded.set(descriptionFile, pending);
    }
    return pending;
  };
  const rows: CliToolRowFull[] = [];
  const missing: string[] = [];
  for (const command of readToolCommands(rootDir)) {
    const placeholder = (summary: string, available: boolean): CliToolRowFull => ({
      name: command.name,
      ...(command.subcommand === undefined ? {} : { subcommand: command.subcommand }),
      summary,
      risk: PLACEHOLDER_RISK,
      needs: ["none"],
      usage: `bun run ${command.name}`,
      file: command.file,
      available,
    });
    if (!existsSync(join(rootDir, command.file))) {
      rows.push(placeholder("(not in this install)", false));
      continue;
    }
    const descriptions = await load(command.descriptionFile);
    if (descriptions === null) {
      rows.push(placeholder(NO_DESCRIPTION, true));
      continue;
    }
    const description = descriptions.find((item) => item.name === command.name);
    if (description === undefined) {
      missing.push(command.name);
      continue;
    }
    rows.push({ ...description, file: command.file, available: true });
  }
  return { rows, missing };
}
