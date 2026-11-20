import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { runCli, type CliSpec } from "../platform/cli";

import { cliDescriptions, parseApiSpecArgs } from "./api-spec-args";
import { buildSpecText, REPO_ROOT, SPEC_FILE } from "./lib/api-spec-build";

const exitClean = 0;
const exitDrift = 1;

/** Writes `docs/api/openapi.json`, or with `--check` exits 1 `openapi_drift` when the file differs from the app. */
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseApiSpecArgs(argv);
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
};

if (import.meta.main) {
  await runCli({ prefix: "api-spec", descriptions: cliDescriptions, main });
}
