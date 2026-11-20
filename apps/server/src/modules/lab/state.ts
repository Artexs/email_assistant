import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import { type BotReplyPlan, type LiveRunPlan, MINUTE_MS } from "@ea/core";

import { MONTH_CAP_USD, monthOf, monthSpend, readLedger, runCap } from "../../platform/eval-ledger";

// The durable state of the live lab: orgs, runs, events, locks and the spend ledger, all files under one directory.
// Layout: orgs.json, runs/<runId>/{run.json,events.jsonl}, locks/<org>.lock, eval-spend.jsonl.
// Events hold ids, codes and counts only: never mail text, a subject or a token.

export type LabOrgKey = "lab" | "demo";
export interface LabOrg {
  orgId: string;
  mailboxId: string;
  address: string;
  chatId: number;
}

export type { BotReplyPlan };

export type StopReason = "done" | "budget" | "operator" | `error:${string}`;

export type LabEvent =
  | { t: "inject_intent" | "inject_done"; slotId: string; messageId: string; lateBySec?: number }
  | { t: "inject_error"; slotId: string; code: string }
  // `delegate` is the persona key and `uid` the UID in the INBOX of its address: the bot reads the mail again when the
  // reply is due, because an event never holds an address, a subject or text.
  | { t: "bot_planned"; key: string; at: string; reply: BotReplyPlan; delegate: string; uid: number }
  | { t: "bot_intent" | "bot_done"; key: string; messageId: string }
  // One failed send or render of a bot reply. The fifth error of one key ends it with a `skip` (`send_failed`).
  | { t: "bot_error"; key: string; code: string }
  | { t: "tap_planned"; key: string; at: string; data: string; messageId: number; then?: "p" | "n" }
  | { t: "tap_intent" | "tap_done"; key: string; data: string }
  | { t: "seen"; part: string; ref: string }
  | { t: "mode"; mode: "shadow" | "assist" }
  | { t: "skip"; code: string; ref: string }
  | { t: "stopped"; reason: StopReason };

// `loggedAt` is the time the store wrote the line. It is not `at`: `bot_planned` and `tap_planned` carry their own `at`.
export type LoggedLabEvent = LabEvent & { loggedAt: string };

export interface LabRun {
  plan: LiveRunPlan;
  org: LabOrgKey;
  capUsd: number;
  modePlan?: { assistFromDay: number };
}

export type LabState = ReturnType<typeof createLabState>;

const RUN_ID = /^[a-z0-9-]{1,40}$/;
// A lock whose run folder never appeared (a crash between the lock and the run file) is taken over after this time.
const ORPHAN_LOCK_MS = MINUTE_MS;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Writes the file whole through a rename, so a reader never sees half a file.
function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function createLabState(dir: string, now: () => Date) {
  const runsDir = join(dir, "runs");
  const locksDir = join(dir, "locks");
  const ledger = join(dir, "eval-spend.jsonl");
  const orgsFile = join(dir, "orgs.json");

  const runDir = (runId: string): string => {
    if (!RUN_ID.test(runId)) throw new Error("lab state: bad run id");
    return join(runsDir, runId);
  };
  const eventsFile = (runId: string): string => join(runDir(runId), "events.jsonl");
  const lockFile = (org: LabOrgKey): string => join(locksDir, `${org}.lock`);

  function readEvents(runId: string): { events: LoggedLabEvent[]; broken: number } {
    let text: string;
    try {
      text = readFileSync(eventsFile(runId), "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { events: [], broken: 0 };
      throw error;
    }
    const events: LoggedLabEvent[] = [];
    let broken = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        events.push(JSON.parse(line) as LoggedLabEvent);
      } catch {
        // A crash in the middle of a write cuts the last line; the count also shows any other damage.
        broken += 1;
      }
    }
    return { events, broken };
  }

  const isStopped = (runId: string): boolean => readEvents(runId).events.some((event) => event.t === "stopped");
  const runExists = (runId: string): boolean => existsSync(join(runDir(runId), "run.json"));

  function lockHolder(org: LabOrgKey): string | undefined {
    try {
      return readFileSync(lockFile(org), "utf8").trim();
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  // The lock is free when it names a stopped run, or a run that never got its folder and the lock is old.
  function lockIsStale(org: LabOrgKey, holder: string): boolean {
    if (!RUN_ID.test(holder)) return true;
    if (runExists(holder)) return isStopped(holder);
    try {
      return Date.now() - statSync(lockFile(org)).mtimeMs > ORPHAN_LOCK_MS;
    } catch {
      return false;
    }
  }

  function createLock(org: LabOrgKey, runId: string): boolean {
    try {
      const fd = openSync(lockFile(org), "wx");
      writeSync(fd, `${runId}\n`);
      fsyncSync(fd);
      closeSync(fd);
      return true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      throw error;
    }
  }

  // One rename wins when two starts try the takeover. If the parked file is not the stale lock we read, it goes back.
  function takeOverStaleLock(org: LabOrgKey, holder: string): boolean {
    const path = lockFile(org);
    const parked = `${path}.stale-${process.pid}-${randomUUID()}`;
    try {
      renameSync(path, parked);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
    const parkedHolder = readFileSync(parked, "utf8").trim();
    if (parkedHolder !== holder) {
      try {
        linkSync(parked, path);
      } catch {
        // A newer lock exists already: nothing to restore.
      }
      rmSync(parked, { force: true });
      return false;
    }
    rmSync(parked, { force: true });
    return true;
  }

  function takeLock(org: LabOrgKey, runId: string): boolean {
    mkdirSync(locksDir, { recursive: true });
    if (createLock(org, runId)) return true;
    const holder = lockHolder(org);
    if (holder === undefined) return createLock(org, runId);
    if (!lockIsStale(org, holder)) return false;
    if (!takeOverStaleLock(org, holder)) return false;
    return createLock(org, runId);
  }

  function listRuns(): string[] {
    if (!existsSync(runsDir)) return [];
    return readdirSync(runsDir)
      .filter((name) => RUN_ID.test(name) && runExists(name))
      .sort();
  }

  function readRun(runId: string): LabRun {
    return readJson(join(runDir(runId), "run.json")) as LabRun;
  }

  // A run is active when it has no `stopped` event and the lock of its org names it.
  function activeRuns(): string[] {
    return listRuns().filter((runId) => !isStopped(runId) && lockHolder(readRun(runId).org) === runId);
  }

  return {
    readOrgs(): Partial<Record<LabOrgKey, LabOrg>> {
      try {
        return readJson(orgsFile) as Partial<Record<LabOrgKey, LabOrg>>;
      } catch (error) {
        if (errorCode(error) === "ENOENT") return {};
        throw error;
      }
    },

    writeOrgs(orgs: Partial<Record<LabOrgKey, LabOrg>>): void {
      mkdirSync(dir, { recursive: true });
      writeJsonAtomic(orgsFile, orgs);
    },

    // The lock comes first. A refused start writes nothing, so it never leaves a second active run.
    startRun(run: LabRun): "ok" | "run_active" {
      const runId = run.plan.runId;
      const folder = runDir(runId);
      if (!takeLock(run.org, runId)) return "run_active";
      try {
        mkdirSync(folder, { recursive: true });
        writeFileSync(eventsFile(runId), "", { flag: "a" });
        writeJsonAtomic(join(folder, "run.json"), run);
      } catch (error) {
        rmSync(lockFile(run.org), { force: true });
        throw error;
      }
      return "ok";
    },

    readRun,
    listRuns,
    activeRuns,

    // One line, synced before it returns: an `intent` event must be on disk before the outside write it announces.
    append(runId: string, event: LabEvent): void {
      const line = `${JSON.stringify({ ...event, loggedAt: now().toISOString() })}\n`;
      const fd = openSync(eventsFile(runId), "a");
      try {
        writeSync(fd, line);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },

    // A cut last line (a crash in the middle of a write) is skipped; `brokenLines` counts it.
    events(runId: string): LoggedLabEvent[] {
      return readEvents(runId).events;
    },
    brokenLines(runId: string): number {
      return readEvents(runId).broken;
    },

    // The only writer of `stopped`. A second call changes nothing. It frees the lock of the org.
    stopRun(runId: string, reason: StopReason): void {
      const run = readRun(runId);
      if (!isStopped(runId)) {
        const line = `${JSON.stringify({ t: "stopped", reason, loggedAt: now().toISOString() })}\n`;
        appendFileSync(eventsFile(runId), line);
      }
      if (lockHolder(run.org) === runId) rmSync(lockFile(run.org), { force: true });
    },

    ledgerPath(): string {
      return ledger;
    },

    // The cap a new run may have: min(request, month cap - month spend - caps of the active runs). The ledger gets a
    // line only when a run finishes, so the caps of active runs count as spent.
    capFor(requestedUsd: number): number {
      const committed = activeRuns().reduce((sum, runId) => sum + readRun(runId).capUsd, 0);
      const spent = monthSpend(readLedger(ledger), monthOf(now()));
      return runCap({ requested: requestedUsd, monthSpent: spent + committed, monthCap: MONTH_CAP_USD });
    },
  };
}

// Failures of one slot so far, from the `inject_error` events. The count survives a restart because the events do.
export function injectErrorCounts(events: readonly LabEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.t === "inject_error") counts.set(event.slotId, (counts.get(event.slotId) ?? 0) + 1);
  }
  return counts;
}

// A slot the injector must still try: no `inject_done` and no `skip` for it.
export function slotsToInject(slotIds: readonly string[], events: readonly LabEvent[]): string[] {
  const finished = new Set<string>();
  for (const event of events) {
    if (event.t === "inject_done") finished.add(event.slotId);
    if (event.t === "skip") finished.add(event.ref);
  }
  return slotIds.filter((id) => !finished.has(id));
}
