import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

// The two files of the serve process under `LAB_STATE_DIR`: the serve lock and the heartbeat file `serve.json`.
// Neither holds mail data: the lock holds a host name, a PID namespace id, a process id and a random token; the heartbeat holds a time,
// run ids and counts.

// A live serve process touches the lock this often. A lock that nobody touched for `SERVE_LOCK_STALE_MS` is stale.
export const SERVE_HEARTBEAT_MS = 10_000;
export const SERVE_LOCK_STALE_MS = 90_000;

export interface ServeLock {
  /**
   * Refreshes the time of the lock file: the proof that the holder lives. Returns false when the file is gone or holds
   * another token: the lock is lost, and the serve loop must stop at once (a second serve must never run beside the first).
   */
  touch(): boolean;
  /** Removes the lock when it is still ours. */
  release(): void;
}

interface Holder {
  host: string;
  // The id of the PID namespace of the process. Process ids mean something only inside one namespace.
  ns: string;
  pid: number;
  token: string;
}

export interface ServeIdentity {
  host: string;
  ns: string;
  pid: number;
}

// `lab` joins the network namespace of `fake-telegram` (`network_mode: service:`), and Docker copies the host name of the
// joined container: every lab container, and every `docker compose run lab`, has the same host name and its own PID
// namespace. So the host name alone says nothing about process ids. The namespace id of `/proc/self/ns/pid` does; when
// it cannot be read, a random id per process makes every other process count as a foreign namespace.
const FALLBACK_NS = `unreadable-${randomUUID()}`;
function pidNamespace(): string {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return FALLBACK_NS;
  }
}

// The tokens of the locks this process holds. A second take in the same process finds its own token and fails.
const held = new Set<string>();

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

function parseHolder(text: string): Holder | undefined {
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    if (
      typeof value.host === "string" &&
      typeof value.ns === "string" &&
      typeof value.pid === "number" &&
      typeof value.token === "string"
    ) {
      return { host: value.host, ns: value.ns, pid: value.pid, token: value.token };
    }
  } catch {
    // An unreadable file is judged by its age alone.
  }
  return undefined;
}

function processLives(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and belongs to another user.
    return errorCode(error) === "EPERM";
  }
}

// Another container shares the state volume but not the process ids, so across PID namespaces only the age of the lock
// decides. Inside one namespace of one host a dead process, or the same process id with a token this process does not
// hold (the container restarted and the id 1 is new), frees the lock at once. A lock with no namespace id (an old file)
// is judged by its age alone.
function isStale(holder: Holder | undefined, ageMs: number, me: ServeIdentity): boolean {
  if (ageMs > SERVE_LOCK_STALE_MS) return true;
  if (holder === undefined || holder.host !== me.host || holder.ns !== me.ns) return false;
  if (holder.pid === me.pid) return !held.has(holder.token);
  return !processLives(holder.pid);
}

/**
 * The `O_EXCL` lock of the serve process: one `lab serve` writes the run events, injects, answers and taps. A second
 * process on the same state directory gets `undefined` and must exit 1 before it writes anything. A stale lock (see
 * `isStale`) is taken over; one rename wins when two processes try it.
 */
export function takeServeLock(
  dir: string,
  now: () => Date = () => new Date(),
  // Only a test passes it.
  identity: ServeIdentity = { host: hostname(), ns: pidNamespace(), pid: process.pid }
): ServeLock | undefined {
  const locks = join(dir, "locks");
  const path = join(locks, "serve.lock");
  mkdirSync(locks, { recursive: true });
  const me = identity;
  const mine: Holder = { ...me, token: randomUUID() };

  const create = (): boolean => {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, `${JSON.stringify(mine)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      return true;
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      throw error;
    }
  };

  let taken = create();
  for (let attempt = 0; !taken && attempt < 3; attempt += 1) {
    let text: string;
    let ageMs: number;
    try {
      text = readFileSync(path, "utf8");
      ageMs = now().getTime() - statSync(path).mtimeMs;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      taken = create();
      continue;
    }
    if (!isStale(parseHolder(text), ageMs, me)) return undefined;
    // Park the lock first: of two processes that see the same stale lock, one rename wins.
    const parked = `${path}.stale-${process.pid}-${randomUUID()}`;
    try {
      renameSync(path, parked);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        taken = create();
        continue;
      }
      throw error;
    }
    if (readFileSync(parked, "utf8") !== text) {
      // It was a newer lock, not the stale one we read: put it back.
      try {
        linkSync(parked, path);
      } catch {
        // A newer lock exists already: nothing to restore.
      }
      rmSync(parked, { force: true });
      return undefined;
    }
    rmSync(parked, { force: true });
    taken = create();
  }
  if (!taken) return undefined;

  held.add(mine.token);
  return {
    touch() {
      const time = now();
      try {
        // A foreign token means another process took the lock over (it judged ours stale): ours is lost.
        if (parseHolder(readFileSync(path, "utf8"))?.token !== mine.token) return false;
        utimesSync(path, time, time);
        return true;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        return false;
      }
    },
    release() {
      held.delete(mine.token);
      try {
        if (parseHolder(readFileSync(path, "utf8"))?.token === mine.token) rmSync(path, { force: true });
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    },
  };
}

// What `lab status` shows of the serve process: when the last tick ended and, per active run, the counts that are not
// 0: a part name gives its failures in a row; `bots_failed` gives the failed items of the last bots tick.
export interface ServeStatus {
  tickAt: string;
  runs: Record<string, Record<string, number>>;
}

const statusFile = (dir: string): string => join(dir, "serve.json");

// Written whole through a rename, so `lab status` never reads half a file.
export function writeServeStatus(dir: string, status: ServeStatus): void {
  mkdirSync(dir, { recursive: true });
  const temp = `${statusFile(dir)}.${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(status)}\n`);
  renameSync(temp, statusFile(dir));
}

export function readServeStatus(dir: string): ServeStatus | undefined {
  try {
    return JSON.parse(readFileSync(statusFile(dir), "utf8")) as ServeStatus;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}
