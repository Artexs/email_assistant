// The gate files of the demo run: the committed classifier files that the plan reads, and the folder that holds the gate copy.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type GateFile, gateFileSchema } from "../../../../server/src/modules/triage";

/** The classifier gate files of a folder, sorted by name. A file that does not parse is skipped, as the server does. */
export function readClassifierGates(dir: string): GateFile[] {
  const files: GateFile[] = [];
  for (const name of readdirSync(dir)
    .filter((entry) => entry.startsWith("classifier-") && entry.endsWith(".json"))
    .sort()) {
    const parsed = gateFileSchema.safeParse(JSON.parse(readFileSync(join(dir, name), "utf8")));
    if (parsed.success && parsed.data.role === "classifier") files.push(parsed.data);
  }
  return files;
}

/** A new folder with the gate copy as its one file (`GATE_EVIDENCE_DIR` of the demo server). */
export function writeGateDir(dir: string, copy: { file: GateFile; fileName: string }): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, copy.fileName), `${JSON.stringify(copy.file, null, 2)}\n`);
}
