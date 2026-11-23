import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { SHEET_STATES } from "./routes";

// Where a run writes: `UI_SHEET_DIR`, else a folder of the job (or `local`) under the user's data folder, outside the worktree.
export function sheetDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const set = env.UI_SHEET_DIR;
  if (set !== undefined && set !== "") return resolve(set);
  const job = env.LIMEN_JOB_ID !== undefined && env.LIMEN_JOB_ID !== "" ? env.LIMEN_JOB_ID : "local";
  return join(homedir(), ".local/share/email-assistant/ui-sheet", job);
}

// The rows a run limits itself to (`UI_SHEET_ROUTES=a,b`), or `null` for all.
export function sheetRouteFilter(env: Readonly<Record<string, string | undefined>> = process.env): string[] | null {
  const set = env.UI_SHEET_ROUTES;
  if (set === undefined || set.trim() === "") return null;
  return set
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

// Removes what an earlier run wrote: the index and the folder of each state. Anything else in the folder stays.
export function emptySheetDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    if (entry === "index.html" || (SHEET_STATES as readonly string[]).includes(entry)) {
      rmSync(join(dir, entry), { recursive: true, force: true });
    }
  }
}
