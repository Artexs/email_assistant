import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createCliOutput } from "../platform/cli";
import { describeError } from "../platform/errors";

import { apiSpecUsage, buildSpecText, parseApiSpecArgs, REPO_ROOT, SPEC_FILE } from "./lib/api-spec-build";

const out = createCliOutput("api-spec");

const exitClean = 0;
const exitDrift = 1;
const exitUsage = 2;

/** Writes `docs/api/openapi.json`, or with `--check` exits 1 `openapi_drift` when the file differs from the app. */
async function main(): Promise<number> {
  const args = parseApiSpecArgs(process.argv.slice(2));
  if (args === null) {
    out.fail(apiSpecUsage);
    return exitUsage;
  }
  const path = join(REPO_ROOT, SPEC_FILE);
  const text = await buildSpecText();
  if (args.check) {
    let current: string | null = null;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = null;
    }
    if (current === text) {
      out.print(`openapi_ok ${SPEC_FILE}`);
      return exitClean;
    }
    out.fail(`openapi_drift ${SPEC_FILE}: run "bun run api:spec" and commit the file`);
    return exitDrift;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  out.print(`wrote ${SPEC_FILE}`);
  return exitClean;
}

try {
  process.exit(await main());
} catch (error) {
  out.fail(`failed: ${describeError(error)}`);
  process.exit(exitUsage);
}
