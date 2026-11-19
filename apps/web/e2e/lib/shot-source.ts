import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Where the docs shots (and, in stage 10, the demo recording) take their data from: the demo organization when its seed file is
// there, else the e2e seed. Pure apart from the file check, which a test fills with a fake.
export const DEFAULT_DEMO_SEED_FILE = resolve(import.meta.dirname, "../demo/demo-seed.json");

export type ShotSource = { kind: "demo"; file: string } | { kind: "e2e" };

// `DEMO_SEED_FILE` set (not empty): that file, and a path that does not exist is the error `demo_seed_missing`, never a silent
// fallback to the e2e seed. Not set: the default file when it exists, else the e2e seed.
export function shotSource(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync
): ShotSource {
  const named = env.DEMO_SEED_FILE;
  if (named !== undefined && named !== "") {
    const file = resolve(named);
    if (!exists(file)) throw new Error("demo_seed_missing");
    return { kind: "demo", file };
  }
  return exists(DEFAULT_DEMO_SEED_FILE) ? { kind: "demo", file: DEFAULT_DEMO_SEED_FILE } : { kind: "e2e" };
}
