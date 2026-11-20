import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createCliOutput } from "../platform/cli";
import { describeError } from "../platform/errors";

import { nextCommands, prepareRelease, releasePrepareUsage } from "./lib/release-prepare-lib";
import { parseReleasePrepareArgs } from "./release-prepare-args";

const out = createCliOutput("release-prepare");

const exitDone = 0;
const exitFailure = 1;
const exitRefused = 2;

/** Sets the version in package.json and moves the changelog items. Runs no git command. */
function main(): number {
  const args = parseReleasePrepareArgs(process.argv.slice(2));
  if (args === null) {
    out.fail(releasePrepareUsage);
    return exitRefused;
  }
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
    return exitRefused;
  }
  writeFileSync(changelogPath, result.changelog);
  writeFileSync(packagePath, result.packageJson);
  out.print(`version ${args.version}: package.json and CHANGELOG.md changed. Next:`);
  for (const line of nextCommands(args.version)) out.print(`  ${line}`);
  return exitDone;
}

try {
  process.exit(main());
} catch (error) {
  out.fail(`failed: ${describeError(error)}`);
  process.exit(exitFailure);
}
