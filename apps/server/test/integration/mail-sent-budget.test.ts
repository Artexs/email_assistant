import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createImapMailProvider } from "../../src/modules/mail/imap/client";
import type { SentFolderReader } from "../../src/modules/mail/port";
import { SentBudgetError, startDeadline } from "../../src/modules/mail/sent-budget";
import { SENT_PASS_BUDGET_MS } from "../../src/modules/mail/sent-rules";
import { syncSentFolder, syncSentHeaders, type SentSyncDeps } from "../../src/modules/mail/sent-sync";
import { configureFeatures } from "../../src/modules/tenancy";

import { testDb, withRollback } from "./helpers";
import { ago, depsOf, newOrg, put, rowsOf, stateOf, type Org } from "./mail-sent-fixtures";

// The time budget of one Sent pass.

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

// A manual monotonic clock: a test moves it, the pass reads it.
function manualClock() {
  const clock = { t: 0, now: () => clock.t };
  return clock;
}

// The five read methods of the org's fake provider, with a hook before each one. A hook may move the clock, or return a promise that never resolves.
function hooked(org: Org, hooks: Partial<Record<keyof SentFolderReader, () => Promise<never> | undefined>>) {
  const calls: string[] = [];
  const run = <T>(name: keyof SentFolderReader, call: () => Promise<T>): Promise<T> => {
    calls.push(name);
    const stall = hooks[name]?.();
    return stall === undefined ? call() : (stall as Promise<never>);
  };
  const reader: SentFolderReader = {
    folderStatus: (f) => run("folderStatus", () => org.provider.folderStatus(f)),
    fetchAbove: (f, u) => run("fetchAbove", () => org.provider.fetchAbove(f, u)),
    fetchContent: (f, u) => run("fetchContent", () => org.provider.fetchContent(f, u)),
    searchSinceIn: (f, s) => run("searchSinceIn", () => org.provider.searchSinceIn(f, s)),
    fetchByUidsIn: (f, u) => run("fetchByUidsIn", () => org.provider.fetchByUidsIn(f, u)),
  };
  return { reader, calls };
}

const never = (): Promise<never> => new Promise<never>(() => undefined);

// Mail 3 has an action id: its origin lookup runs in chunk 2 (chunk size 2) and uses up the budget.
function putFive(org: Org) {
  for (let n = 1; n <= 5; n += 1) {
    put(org, n, ago((6 - n) * HOUR_MS), n === 3 ? { headers: { "X-EA-Action-Id": randomUUID() } } : {});
  }
}

function budgetDeps(
  trx: Parameters<typeof depsOf>[0],
  org: Org,
  clock: ReturnType<typeof manualClock>,
  extra: Partial<SentSyncDeps> = {}
) {
  return depsOf(trx, org, {
    budgetMs: 100,
    clock: clock.now,
    chunkSize: 2,
    sentOriginOf: async () => {
      clock.t += 1_000;
      return null;
    },
    ...extra,
  });
}

describe("the default budget", () => {
  test("is 60 seconds", () => {
    expect(SENT_PASS_BUDGET_MS).toBe(MINUTE_MS);
  });
});

describe("the deadline", () => {
  test("after a call that timed out, no later call runs, even with time left", async () => {
    const clock = manualClock();
    const deadline = startDeadline({ budgetMs: 40, clock: clock.now }, 1);
    await expect(deadline.call(never)).rejects.toBeInstanceOf(SentBudgetError);
    let ran = 0;
    // The manual clock did not move: only the timed-out call can make the deadline expire.
    await expect(deadline.call(async () => void (ran += 1))).rejects.toBeInstanceOf(SentBudgetError);
    expect(ran).toBe(0);
  });
});

describe("the timer of a call", () => {
  test("a call that returns clears its timer", async () => {
    const set = spyOn(globalThis, "setTimeout");
    const clear = spyOn(globalThis, "clearTimeout");
    try {
      const deadline = startDeadline({ budgetMs: MINUTE_MS }, 1);
      expect(await deadline.call(async () => 7)).toBe(7);
      const timer = set.mock.results.map((r) => r.value).find((v) => v !== undefined);
      expect(timer).toBeDefined();
      expect(clear.mock.calls.map((c) => c[0] as unknown)).toContain(timer as unknown);
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });
});

describe("header step budget", () => {
  test("incremental: budget used up between chunks gives budget, written chunks stay, cursor at the last chunk", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await org.provider.ensureFolder("Sent");
      expect((await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId)).mode).toBe("initial");
      putFive(org);

      const clock = manualClock();
      const result = await syncSentHeaders(budgetDeps(trx, org, clock), org.ctx, org.mailboxId);

      expect(result).toMatchObject({ status: "budget", mode: "incremental", fetched: 5, stored: 4 });
      expect((await rowsOf(trx, org)).map((row) => row.uid)).toEqual(["1", "2", "3", "4"]);
      const state = await stateOf(trx, org);
      expect(state.lastUid).toBe(4);
      expect(state.lastErrorCode).toBeNull();
      expect(state.lastPassAt?.getTime()).toBe(depsOf(trx, org).now().getTime());

      const next = await syncSentHeaders(depsOf(trx, org, { chunkSize: 2 }), org.ctx, org.mailboxId);
      expect(next).toMatchObject({ status: "done", fetched: 1, stored: 1 });
      expect((await rowsOf(trx, org)).map((row) => row.uid)).toEqual(["1", "2", "3", "4", "5"]);
    });
  });

  test("initial: budget used up gives budget, cursor and firstPassAt stay; a second pass ends done with no duplicate", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      putFive(org);

      const clock = manualClock();
      const result = await syncSentHeaders(budgetDeps(trx, org, clock), org.ctx, org.mailboxId);

      expect(result).toMatchObject({ status: "budget", mode: "initial", stored: 4 });
      const state = await stateOf(trx, org);
      expect(state.lastUid).toBeNull();
      expect(state.uidValidity).toBeNull();
      expect(state.firstPassAt).toBeNull();
      expect(state.lastErrorCode).toBeNull();

      const next = await syncSentHeaders(depsOf(trx, org, { chunkSize: 2 }), org.ctx, org.mailboxId);
      expect(next.status).toBe("done");
      expect((await rowsOf(trx, org)).map((row) => row.uid)).toEqual(["1", "2", "3", "4", "5"]);
      expect((await stateOf(trx, org)).firstPassAt).not.toBeNull();
    });
  });

  test("a budget that is used up before the pass makes no IMAP call", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      putFive(org);
      const { reader, calls } = hooked(org, {});
      const result = await syncSentHeaders(depsOf(trx, org, { provider: reader, budgetMs: 0 }), org.ctx, org.mailboxId);
      expect(result.status).toBe("budget");
      expect(calls).toEqual([]);
      expect(await rowsOf(trx, org)).toEqual([]);
    });
  });

  test("one header call that never returns: the pass returns with budget near the budget, and no later call runs", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      putFive(org);
      const { reader, calls } = hooked(org, { searchSinceIn: never });
      const started = performance.now();
      const result = await syncSentHeaders(
        depsOf(trx, org, { provider: reader, budgetMs: 50 }),
        org.ctx,
        org.mailboxId
      );
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(result.status).toBe("budget");
      expect(calls).toEqual(["folderStatus", "searchSinceIn"]);
      const state = await stateOf(trx, org);
      expect(state.lastErrorCode).toBeNull();
      expect(state.lastPassAt).not.toBeNull();
    });
  });
});

describe("a stalled call at each header step", () => {
  test("folderStatus", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      putFive(org);
      const { reader, calls } = hooked(org, { folderStatus: never });
      const result = await syncSentHeaders(
        depsOf(trx, org, { provider: reader, budgetMs: 50 }),
        org.ctx,
        org.mailboxId
      );
      expect(result.status).toBe("budget");
      expect(calls).toEqual(["folderStatus"]);
      expect((await stateOf(trx, org)).lastErrorCode).toBeNull();
    });
  });

  test("fetchByUidsIn (initial mode)", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      putFive(org);
      const { reader, calls } = hooked(org, { fetchByUidsIn: never });
      const result = await syncSentHeaders(
        depsOf(trx, org, { provider: reader, budgetMs: 50 }),
        org.ctx,
        org.mailboxId
      );
      expect(result.status).toBe("budget");
      expect(calls).toEqual(["folderStatus", "searchSinceIn", "fetchByUidsIn"]);
      expect(await rowsOf(trx, org)).toEqual([]);
    });
  });

  test("fetchAbove (incremental mode): the cursor stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await org.provider.ensureFolder("Sent");
      expect((await syncSentHeaders(depsOf(trx, org), org.ctx, org.mailboxId)).mode).toBe("initial");
      putFive(org);
      const before = (await stateOf(trx, org)).lastUid;
      const { reader, calls } = hooked(org, { fetchAbove: never });
      const result = await syncSentHeaders(
        depsOf(trx, org, { provider: reader, budgetMs: 50 }),
        org.ctx,
        org.mailboxId
      );
      expect(result).toMatchObject({ status: "budget", mode: "incremental" });
      expect(calls).toEqual(["folderStatus", "fetchAbove"]);
      expect((await stateOf(trx, org)).lastUid).toBe(before);
      expect(await rowsOf(trx, org)).toEqual([]);
    });
  });
});

describe("text step budget", () => {
  test("the text step shares the deadline of the header step", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      put(org, 1, ago(4 * HOUR_MS));
      put(org, 2, ago(3 * HOUR_MS), { headers: { "X-EA-Action-Id": randomUUID() } });
      put(org, 3, ago(2 * HOUR_MS));
      const clock = manualClock();
      // The header step uses 400 of 500 ms; each text fetch uses 200 ms more.
      const { reader, calls } = hooked(org, {
        fetchContent: () => {
          clock.t += 200;
          return undefined;
        },
      });
      const result = await syncSentFolder(
        depsOf(trx, org, {
          provider: reader,
          budgetMs: 500,
          clock: clock.now,
          sentOriginOf: async () => {
            clock.t += 400;
            return null;
          },
        }),
        org.ctx,
        org.mailboxId
      );
      expect(result.status).toBe("budget");
      expect(result.texts).toEqual({ stored: 1, gone: 0, expired: 0, budget: true });
      expect(calls.filter((call) => call === "fetchContent")).toHaveLength(1);
    });
  });

  test("budget used up during the text step gives budget, stored texts stay, the rest stay pending", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      for (let n = 1; n <= 3; n += 1) put(org, n, ago((4 - n) * HOUR_MS));
      const clock = manualClock();
      const { reader, calls } = hooked(org, {
        fetchContent: () => {
          clock.t += 1_000;
          return undefined;
        },
      });
      const result = await syncSentFolder(
        depsOf(trx, org, { provider: reader, budgetMs: 500, clock: clock.now }),
        org.ctx,
        org.mailboxId
      );

      expect(result.status).toBe("budget");
      expect(result.stored).toBe(3);
      expect(result.texts).toEqual({ stored: 1, gone: 0, expired: 0, budget: true });
      expect(calls.filter((call) => call === "fetchContent")).toHaveLength(1);
      expect((await rowsOf(trx, org)).map((row) => row.content)).toEqual(["stored", "pending", "pending"]);

      // The next pass reads the rest.
      const next = await syncSentFolder(depsOf(trx, org), org.ctx, org.mailboxId);
      expect(next.texts).toEqual({ stored: 2, gone: 0, expired: 0 });
    });
  });

  test("one fetchContent that never returns: the pass returns near the budget and makes no later IMAP call", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      for (let n = 1; n <= 3; n += 1) put(org, n, ago((4 - n) * HOUR_MS));
      const { reader, calls } = hooked(org, { fetchContent: never });
      const started = performance.now();
      const result = await syncSentFolder(depsOf(trx, org, { provider: reader, budgetMs: 50 }), org.ctx, org.mailboxId);

      expect(performance.now() - started).toBeLessThan(1_000);
      expect(result.status).toBe("budget");
      expect(result.texts).toMatchObject({ stored: 0, budget: true });
      expect(calls.filter((call) => call === "fetchContent")).toHaveLength(1);
      expect((await rowsOf(trx, org)).map((row) => row.content)).toEqual(["pending", "pending", "pending"]);
      expect((await stateOf(trx, org)).lastErrorCode).toBeNull();
    });
  });
});

describe("bounded close", () => {
  test("a LOGOUT that works does not call client.close()", async () => {
    let closed = 0;
    const client = { logout: async () => undefined, close: () => void (closed += 1) };
    const provider = createImapMailProvider(client as never, { bodyLimitBytes: 1, forceCopyMove: false });
    await provider.close();
    expect(closed).toBe(0);
  });
});
