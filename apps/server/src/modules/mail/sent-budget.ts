import type { SentFolderReader } from "./port";

// The time budget of one Sent pass. The pass is the last step of a `mail.sync` run on one IMAP connection: a slow Sent folder must not hold the run.
// The clock is monotonic and injected. Wall time (`now()`) stays the timestamp of the rows.

/** Thrown when the budget is used up, or when an IMAP call did not return in time. It never leaves the Sent pass. */
export class SentBudgetError extends Error {
  constructor() {
    super("Sent pass budget used up");
    this.name = "SentBudgetError";
  }
}

export interface SentBudgetDeps {
  /** Total budget of one pass in ms. Default `SENT_PASS_BUDGET_MS`. */
  budgetMs?: number;
  /** A monotonic clock in ms. Default `performance.now`. */
  clock?(): number;
}

export interface SentDeadline {
  /** True when the budget is used up. */
  expired(): boolean;
  /** Throws `SentBudgetError` when the budget is used up. */
  check(): void;
  /** Runs one IMAP call, and stops waiting for it when the time is up. After a timed-out call, every later call throws. */
  call<T>(run: () => Promise<T>): Promise<T>;
}

export function startDeadline(deps: SentBudgetDeps, defaultBudgetMs: number): SentDeadline {
  const clock = deps.clock ?? (() => performance.now());
  const endsAt = clock() + (deps.budgetMs ?? defaultBudgetMs);
  // After a timed-out call the connection state is unknown: no later call may use it.
  let stalled = false;
  const expired = () => stalled || clock() >= endsAt;
  const check = () => {
    if (expired()) throw new SentBudgetError();
  };
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    check();
    const left = Math.max(0, endsAt - clock());
    const pending = run();
    // The loser of the race may fail later: nobody waits for it, so the failure is not an unhandled rejection.
    pending.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        stalled = true;
        reject(new SentBudgetError());
      }, left);
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
  return { expired, check, call };
}

// The five read methods of the reader, each one through the deadline.
export function budgetedReader(reader: SentFolderReader, deadline: SentDeadline): SentFolderReader {
  return {
    folderStatus: (folder) => deadline.call(() => reader.folderStatus(folder)),
    fetchAbove: (folder, uid) => deadline.call(() => reader.fetchAbove(folder, uid)),
    fetchContent: (folder, uid) => deadline.call(() => reader.fetchContent(folder, uid)),
    searchSinceIn: (folder, since) => deadline.call(() => reader.searchSinceIn(folder, since)),
    fetchByUidsIn: (folder, uids) => deadline.call(() => reader.fetchByUidsIn(folder, uids)),
  };
}
