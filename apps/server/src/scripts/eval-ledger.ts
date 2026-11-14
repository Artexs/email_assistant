import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

export const MONTH_CAP_USD = 20;
export const RUN_CAP_USD = 1;

const STALE_LOCK_MS = 6 * 3_600_000;

// The spend ledger lives outside git: one JSON line per run.
export function defaultLedgerPath(env: { XDG_STATE_HOME?: string; HOME?: string }): string {
  const stateHome = env.XDG_STATE_HOME ?? `${env.HOME ?? ""}/.local/state`;
  return join(stateHome, "email-assistant", "eval-spend.jsonl");
}

// Sum of `usd` of the lines whose `at` falls in the UTC month (YYYY-MM). A line that does not parse is skipped.
export function monthSpend(ledgerText: string, month: string): number {
  let total = 0;
  for (const line of ledgerText.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row: unknown = JSON.parse(line);
      if (typeof row !== "object" || row === null) continue;
      const { at, usd } = row as { at?: unknown; usd?: unknown };
      if (typeof at !== "string" || typeof usd !== "number" || !Number.isFinite(usd)) continue;
      if (at.startsWith(month)) total += usd;
    } catch {
      continue;
    }
  }
  return total;
}

export function runCap(input: { requested: number; monthSpent: number; monthCap: number }): number {
  return Math.max(0, Math.min(input.requested, input.monthCap - input.monthSpent));
}

// The label is `<scenario>-<part>-<model>`: names only, no mail data.
export function ledgerLine(input: { runId: string; at: Date; usd: number; label: string }): string {
  return `${JSON.stringify({ runId: input.runId, at: input.at.toISOString(), usd: input.usd, label: input.label })}\n`;
}

// The month of `at` in UTC, as `YYYY-MM`.
export function monthOf(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function readLedger(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// The time in the lock file; an unreadable lock counts as made now, so it is never taken over by mistake.
function lockTime(lockPath: string): number {
  const written = Date.parse(readLedger(lockPath).trim());
  return Number.isNaN(written) ? Date.now() : written;
}

// One run per state file: an `O_EXCL` lock file next to it. A lock older than 6 h is taken over only with `fresh`.
export function acquireStateLock(stateFile: string, now: Date, opts: { fresh: boolean }): () => void {
  const lockPath = `${stateFile}.lock`;
  const create = (): number => openSync(lockPath, "wx");
  let fd: number;
  try {
    fd = create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = now.getTime() - lockTime(lockPath);
    if (!opts.fresh || age <= STALE_LOCK_MS) {
      throw new Error(`state file is locked by another run: ${lockPath}`);
    }
    rmSync(lockPath, { force: true });
    fd = create();
  }
  writeSync(fd, `${now.toISOString()}\n`);
  closeSync(fd);
  return () => rmSync(lockPath, { force: true });
}
