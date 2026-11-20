import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runCli, type CliSpec } from "../platform/cli";

import { nextCommands, prepareRelease } from "./lib/release-prepare-lib";
import { cliDescriptions, parseReleasePrepareArgs } from "./release-prepare-args";

/** Sets the version in package.json and moves the changelog items. Runs no git command. */
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseReleasePrepareArgs(argv);
  const changelogPath = join(args.root, "CHANGELOG.md");
  const packagePath = join(args.root, "package.json");
  const result = prepareRelease({
    version: args.version,
    date: args.date ?? new Date().toISOString().slice(0, 10),
    changelog: readFileSync(changelogPath, "utf8"),
    packageJson: readFileSync(packagePath, "utf8"),
  });
  if (!result.ok) {
    out.fail(`refused, no file changed: ${result.reason}`);
    return 1;
  }
  writeFileSync(changelogPath, result.changelog);
  writeFileSync(packagePath, result.packageJson);
  out.print(`version ${args.version}: package.json and CHANGELOG.md changed. Next:`);
  for (const line of nextCommands(args.version)) out.print(`  ${line}`);
  return 0;
};

if (import.meta.main) {
  await runCli({ prefix: "release-prepare", descriptions: cliDescriptions, main });
}
