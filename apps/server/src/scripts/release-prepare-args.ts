import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

import { versionPattern } from "./lib/release-prepare-lib";

export const cliDescriptions = [
  {
    name: "release:prepare",
    summary: "Sets the version in package.json and moves the changelog items of Unreleased to it.",
    risk: "write",
    // It reads and writes `package.json` and `CHANGELOG.md` in the working tree and runs no git command.
    needs: ["none"],
    usage: "bun run release:prepare <x.y.z> [--date YYYY-MM-DD] [--root <folder>]",
    exits: { 1: "version not greater, Unreleased empty or a file bad: no file changed" },
  },
] satisfies readonly CliDescription[];

export interface ReleasePrepareArgs {
  version: string;
  /** UTC date `YYYY-MM-DD`; set by `--date` (tests), else today. */
  date: string | null;
  root: string;
}

/** One version argument `x.y.z`, `--date` and `--root` (default: the current folder). Throws `UsageError` (or a `parseArgs` error) on any bad argument. */
export function parseReleasePrepareArgs(argv: string[]): ReleasePrepareArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { date: { type: "string" }, root: { type: "string" } },
    allowPositionals: true,
    strict: true,
  });
  const [version] = positionals;
  if (positionals.length !== 1 || version === undefined) throw new UsageError("one version <x.y.z> is required");
  if (!versionPattern.test(version)) throw new UsageError("the version is x.y.z, three whole numbers");
  if (values.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
    throw new UsageError("--date is YYYY-MM-DD");
  }
  if (values.root === "") throw new UsageError("--root is not empty");
  return { version, date: values.date ?? null, root: values.root ?? "." };
}
