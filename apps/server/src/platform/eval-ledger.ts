import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export const MONTH_CAP_USD = 20;
export const RUN_CAP_USD = 1;

const STALE_LOCK_MS = 6 * 3_600_000;

// The spend ledger lives outside git: one JSON line per run. An empty or relative value counts as unset; with no
// usable directory the run cannot count its spend, so it refuses (use --spend-ledger).
export function defaultLedgerPath(env: { XDG_STATE_HOME?: string; HOME?: string }): string {
  const usable = (value: string | undefined): value is string =>
    value !== undefined && value.trim() !== "" && isAbsolute(value);
  const stateHome = usable(env.XDG_STATE_HOME)
    ? env.XDG_STATE_HOME
    : usable(env.HOME)
      ? join(env.HOME, ".local", "state")
      : null;
  if (stateHome === null) {
    throw new Error(
      "no place for the spend ledger: set XDG_STATE_HOME or HOME to an absolute path, or pass --spend-ledger"
    );
  }
  return join(stateHome, "email-assistant", "eval-spend.jsonl");
}

// Sum of `usd` of the lines whose `at` falls in the UTC month (YYYY-MM). A line that does not parse, or whose `usd`
// is negative or not finite, is skipped: it must never lower the month spend.
export function monthSpend(ledgerText: string, month: string): number {
  let total = 0;
  for (const line of ledgerText.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row: unknown = JSON.parse(line);
      if (typeof row !== "object" || row === null) continue;
      const { at, usd } = row as { at?: unknown; usd?: unknown };
      if (typeof at !== "string" || typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) continue;
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

// Appends one line. A file that does not end with a newline (a cut write) gets one first, so lines never merge.
export function appendLedgerLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const text = readLedger(path);
  appendFileSync(path, `${text === "" || text.endsWith("\n") ? "" : "\n"}${line}`);
}

// The time in the lock file; an unreadable lock counts as made now, so it is never taken over by mistake.
function lockTime(lockPath: string): number {
  const written = Date.parse(readLedger(lockPath).trim());
  return Number.isNaN(written) ? Date.now() : written;
}

// One run per state file: an `O_EXCL` lock file next to it. A lock older than 6 h is taken over only with `fresh`.
// The takeover does not delete the lock in place: it renames the stale lock to a unique name (one rename wins when two
// runs try it), checks the parked file is really stale, then creates the new lock with `wx`. If the parked file was a
// fresh lock (another run replaced the stale one between our check and our rename), it is linked back and we refuse.
export function acquireStateLock(stateFile: string, now: Date, opts: { fresh: boolean }): () => void {
  const lockPath = `${stateFile}.lock`;
  const locked = (): Error => new Error(`state file is locked by another run: ${lockPath}`);
  const create = (): number => {
    try {
      return openSync(lockPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw locked();
      throw error;
    }
  };
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!opts.fresh || now.getTime() - lockTime(lockPath) <= STALE_LOCK_MS) throw locked();
    const parked = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
    try {
      renameSync(lockPath, parked);
    } catch (renameError) {
      // Another run took the stale lock first: the create below decides.
      if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") throw renameError;
      fd = create();
      writeSync(fd, `${now.toISOString()}\n`);
      closeSync(fd);
      return () => rmSync(lockPath, { force: true });
    }
    if (now.getTime() - lockTime(parked) <= STALE_LOCK_MS) {
      try {
        linkSync(parked, lockPath);
      } catch {
        // A newer lock exists already: nothing to restore.
      }
      rmSync(parked, { force: true });
      throw locked();
    }
    rmSync(parked, { force: true });
    fd = create();
  }
  writeSync(fd, `${now.toISOString()}\n`);
  closeSync(fd);
  return () => rmSync(lockPath, { force: true });
}
