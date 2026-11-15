import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { DemoSeedError } from "./types";

/** Writes a new file with mode 0600 (a seed is lab data, but only its owner reads it). An export never overwrites: an existing file is `out_exists`. */
export function writeNewSeedFile(path: string, text: string): void {
  try {
    writeFileSync(resolve(path), text, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DemoSeedError("out_exists");
    throw error;
  }
}

/** The text of a seed file, or undefined when it cannot be read. */
export function readSeedFile(path: string): string | undefined {
  try {
    return readFileSync(resolve(path), "utf8");
  } catch {
    return undefined;
  }
}
