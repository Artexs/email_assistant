import { readFileSync } from "node:fs";

// A type only: the seed's database guards stay in the server package, and e2e-seed-args.ts imports no test tooling.
import type { SeedFile } from "../../server/src/scripts/e2e-seed-args";

import { repoRoot } from "./env";

// The global setup runs `apps/server/src/scripts/e2e-seed.ts`, which writes the owner, one assistant per project and their links.
export function readSeed(): SeedFile {
  const path = `${repoRoot}/apps/web/e2e/.seed.json`;
  return JSON.parse(readFileSync(path, "utf8")) as SeedFile;
}
