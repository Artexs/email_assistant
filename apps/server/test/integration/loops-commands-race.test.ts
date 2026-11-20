// The loop commands on real connections. Committed rows; the organizations and users are deleted at the end.
// Each case runs on the app role, on the table owner (it has no row level security, so only the org filters of the queries
// hold) and on a mix of both. The rules under test: one follow-up waits at a time; a loop closes once (one audit row, one
// expiry of its send); Later has three uses and no fourth; a reopen happens once and never on a loop with cleared texts;
// a follow-up never waits on a closed loop.
import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { updateMailboxSettings } from "../../src/modules/config";
import {
  clearLoopTexts,
  doneLoop,
  draftFollowUp,
  dropLoop,
  laterLoop,
  reopenLoop,
  untrackLoop,
  type DraftFollowUpResult,
} from "../../src/modules/loops";
import { getSentSyncState, setSentSync } from "../../src/modules/mail";
import { createDb, type Db, type DB } from "../../src/platform/db";

import { testDb } from "./helpers";
import {
  actionsOfLoop,
  auditOf,
  commandLoop,
  commandOrg,
  FRIDAY,
  loopOf,
  type CommandOrg,
} from "./loops-commands-fixtures";

const app = testDb();
const appB = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (ownerUrl === undefined)
  throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the table owner cases");
const owner = createDb(ownerUrl);
const ownerB = createDb(ownerUrl);

const orgs: string[] = [];
const users: string[] = [];
afterAll(async () => {
  for (const id of orgs) await app.deleteFrom("organizations").where("id", "=", id).execute();
  for (const id of users) await app.deleteFrom("users").where("id", "=", id).execute();
  await Promise.all([app.destroy(), appB.destroy(), owner.destroy(), ownerB.destroy()]);
});

const ROUNDS = 12;
const pairs: [string, Db, Db][] = [
  ["app role", app, appB],
  ["table owner", owner, ownerB],
  ["app role and table owner", app, ownerB],
];

async function newOrg(opts: Parameters<typeof commandOrg>[1] = {}): Promise<CommandOrg> {
  const org = await app.transaction().execute((trx) => commandOrg(trx, opts));
  orgs.push(org.ctx.orgId);
  users.push(org.userId, org.memberId);
  return org;
}

const loopIn = (org: CommandOrg, over: Parameters<typeof commandLoop>[2] = {}) =>
  app.transaction().execute((trx: Transaction<DB>) => commandLoop(trx, org, over));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => sleep(Math.floor(Math.random() * 6));
const input = (org: CommandOrg, loopId: string, userId = org.userId) => ({ loopId, userId, via: "web" as const });
const at = { now: () => FRIDAY };

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timeout: a deadlock?")), ms)),
  ]);

const kinds = (results: readonly { kind: string }[]) => results.map((result) => result.kind).sort();
const sendOf = async (loopId: string) => (await actionsOfLoop(app, loopId)).find((row) => row.type === "send");

describe.each(pairs)("two follow-up taps at once (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} loops: one pair, one planned, the other waiting with the same send, two audit rows`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const loop = await loopIn(org);
      const results = await withTimeout(
        Promise.all([
          draftFollowUp({ db: connA, ...at }, org.ctx, input(org, loop.id)),
          jitter().then(() => draftFollowUp({ db: connB, ...at }, org.ctx, input(org, loop.id))),
        ]),
        8_000
      );
      expect(kinds(results)).toEqual(["planned", "waiting"]);
      const planned = results.find(
        (result): result is Extract<DraftFollowUpResult, { kind: "planned" }> => result.kind === "planned"
      );
      const waiting = results.find(
        (result): result is Extract<DraftFollowUpResult, { kind: "waiting" }> => result.kind === "waiting"
      );
      expect(waiting?.sendId).toBe(planned?.sendId ?? "");
      const rows = await actionsOfLoop(app, loop.id);
      expect(rows.map((row) => `${row.type}:${row.status}`)).toEqual(["create_draft:ready", "send:awaiting_approval"]);
      expect(rows.map((row) => row.idempotency_key).sort()).toEqual([
        `${loop.id}:create_draft:follow_up:1:1`,
        `${loop.id}:send:follow_up:1:1`,
      ]);
    }
    const planned = await auditOf(app, org.ctx.orgId, "action.planned");
    expect(planned).toHaveLength(ROUNDS * 2);
  }, 40_000);

  test(`${ROUNDS} loops: three taps at once after a rejected follow-up give one new pair with k 2`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const loop = await loopIn(org);
      const first = await draftFollowUp({ db: app, ...at }, org.ctx, input(org, loop.id));
      await app
        .updateTable("actions")
        .set({ status: "rejected" })
        .where("id", "=", first.kind === "planned" ? first.sendId : "")
        .execute();
      const results = await withTimeout(
        Promise.all([
          draftFollowUp({ db: connA, ...at }, org.ctx, input(org, loop.id)),
          jitter().then(() => draftFollowUp({ db: connB, ...at }, org.ctx, input(org, loop.id))),
          jitter().then(() => draftFollowUp({ db: connA, ...at }, org.ctx, input(org, loop.id))),
        ]),
        8_000
      );
      expect(kinds(results)).toEqual(["planned", "waiting", "waiting"]);
      const keys = (await actionsOfLoop(app, loop.id)).map((row) => row.idempotency_key).sort();
      expect(keys).toEqual([
        `${loop.id}:create_draft:follow_up:1:1`,
        `${loop.id}:create_draft:follow_up:1:2`,
        `${loop.id}:send:follow_up:1:1`,
        `${loop.id}:send:follow_up:1:2`,
      ]);
    }
  }, 40_000);
});

describe.each(pairs)("a follow-up tap and a closing command at once (%s)", (_name, connA, connB) => {
  const closers = [
    ["Done", doneLoop, "waiting"],
    ["Drop", dropLoop, "waiting"],
    ["Untrack", untrackLoop, "delegated"],
  ] as const;
  for (const [name, close, kind] of closers) {
    test(`${ROUNDS} loops, ${name}: a closed loop never keeps a waiting follow-up`, async () => {
      const org = await newOrg();
      for (let i = 0; i < ROUNDS; i += 1) {
        const loop = await loopIn(org, { kind });
        const [draft, closed] = await withTimeout(
          Promise.all([
            draftFollowUp({ db: connA, ...at }, org.ctx, input(org, loop.id)),
            jitter().then(() => close({ db: connB, ...at }, org.ctx, input(org, loop.id))),
          ]),
          8_000
        );
        expect(closed.kind).toBe("ok");
        expect(["planned", "closed"]).toContain(draft.kind);
        const row = await loopOf(app, loop.id);
        expect(row.status).toBe("closed");
        const send = await sendOf(loop.id);
        // Either the tap came first and the close ended its send, or the close came first and no send exists.
        if (draft.kind === "planned") expect([send?.status, send?.status_reason]).toEqual(["expired", "loop_closed"]);
        else expect(send).toBeUndefined();
        expect(
          await auditOf(app, org.ctx.orgId, "loop.closed").then((rows) =>
            rows.filter((r) => (r.data as { loop_id: string }).loop_id === loop.id)
          )
        ).toHaveLength(1);
      }
    }, 40_000);
  }
});

describe.each(pairs)("a command twice at once (%s)", (_name, connA, connB) => {
  const commands = [
    ["Done", doneLoop, "waiting"],
    ["Drop", dropLoop, "waiting"],
    ["Untrack", untrackLoop, "delegated"],
  ] as const;
  for (const [name, command, kind] of commands) {
    test(`${ROUNDS} loops, ${name}: one ok, one already, one audit row, one expiry of the waiting send`, async () => {
      const org = await newOrg();
      for (let i = 0; i < ROUNDS; i += 1) {
        const loop = await loopIn(org, { kind });
        await draftFollowUp({ db: app, ...at }, org.ctx, input(org, loop.id));
        const results = await withTimeout(
          Promise.all([
            command({ db: connA, ...at }, org.ctx, input(org, loop.id)),
            jitter().then(() => command({ db: connB, ...at }, org.ctx, input(org, loop.id))),
          ]),
          8_000
        );
        expect(kinds(results)).toEqual(["already", "ok"]);
        const audit = (await auditOf(app, org.ctx.orgId, "loop.closed")).filter(
          (row) => (row.data as { loop_id: string }).loop_id === loop.id
        );
        expect(audit).toHaveLength(1);
        const sendId = (await sendOf(loop.id))?.id;
        const expired = (await auditOf(app, org.ctx.orgId, "action.expired")).filter((row) => row.action_id === sendId);
        expect(expired).toHaveLength(1);
      }
    }, 40_000);
  }

  test(`${ROUNDS} loops, Done and Drop at once: one closes, the other says already`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const loop = await loopIn(org);
      const results = await withTimeout(
        Promise.all([
          doneLoop({ db: connA, ...at }, org.ctx, input(org, loop.id)),
          jitter().then(() => dropLoop({ db: connB, ...at }, org.ctx, input(org, loop.id))),
        ]),
        8_000
      );
      expect(kinds(results)).toEqual(["already", "ok"]);
      const row = await loopOf(app, loop.id);
      expect(["done", "dropped"]).toContain(row.close_reason ?? "");
      expect(row.closed_by_user_id).toBe(org.userId);
    }
  }, 40_000);

  test(`${ROUNDS} loops, five Later taps at once: three uses, two limit_reached, three audit rows`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const loop = await loopIn(org);
      const results = await withTimeout(
        Promise.all(
          [connA, connB, connA, connB, connA].map((conn, n) =>
            sleep(n % 3).then(() => laterLoop({ db: conn, ...at }, org.ctx, input(org, loop.id, org.memberId)))
          )
        ),
        8_000
      );
      expect(kinds(results)).toEqual(["limit_reached", "limit_reached", "ok", "ok", "ok"]);
      const row = await loopOf(app, loop.id);
      expect(row.later_count).toBe(3);
      // Three different due dates, in order: each use moved from the one before.
      const dues = results.flatMap((result) => (result.kind === "ok" ? [result.dueAt.toISOString()] : [])).sort();
      expect(dues).toEqual(["2026-11-26T16:00:00.000Z", "2026-12-01T16:00:00.000Z", "2026-12-04T16:00:00.000Z"]);
      expect(row.due_at.toISOString()).toBe("2026-12-04T16:00:00.000Z");
    }
    const audit = await auditOf(app, org.ctx.orgId, "loop.later");
    expect(audit).toHaveLength(ROUNDS * 3);
  }, 40_000);

  test(`${ROUNDS} loops, Reopen twice at once: one ok, one already, one audit row`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const loop = await loopIn(org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
      const results = await withTimeout(
        Promise.all([
          reopenLoop({ db: connA, ...at }, org.ctx, input(org, loop.id)),
          jitter().then(() => reopenLoop({ db: connB, ...at }, org.ctx, input(org, loop.id))),
        ]),
        8_000
      );
      expect(kinds(results)).toEqual(["already", "ok"]);
      expect((await loopOf(app, loop.id)).status).toBe("open");
    }
    const audit = await auditOf(app, org.ctx.orgId, "loop.reopened");
    expect(audit).toHaveLength(ROUNDS);
  }, 40_000);
});

describe.each(pairs)("Reopen against the retention clear (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} loops: a loop is never open with cleared texts, and never cleared while open`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const loop = await loopIn(org, {
        status: "closed",
        close_reason: "done",
        closed_at: new Date("2026-01-01T00:00:00Z"),
      });
      const [reopened, cleared] = await withTimeout(
        Promise.all([
          reopenLoop({ db: connA, ...at }, org.ctx, input(org, loop.id)),
          jitter().then(() => clearLoopTexts(connB, org.ctx, { before: FRIDAY, now: FRIDAY })),
        ]),
        8_000
      );
      const row = await loopOf(app, loop.id);
      if (row.status === "open") {
        expect(reopened.kind).toBe("ok");
        expect(row.texts_cleared_at).toBeNull();
        expect(row.subject).toBe("Offer Q1");
        expect(cleared).toBe(0);
      } else {
        expect(reopened.kind).toBe("not_allowed");
        expect(row.texts_cleared_at).not.toBeNull();
        expect(row.subject).toBeNull();
        expect(cleared).toBe(1);
      }
    }
  }, 40_000);
});

describe.each(pairs)("a follow-up tap against a settings change (%s)", (_name, connA, connB) => {
  test("a setter that holds the settings row makes the tap wait; the tap then sees drafts off and plans nothing", async () => {
    const org = await newOrg();
    const loop = await loopIn(org);
    const held = Promise.withResolvers<undefined>();
    const locked = Promise.withResolvers<undefined>();
    const setter = connB.transaction().execute(async (trx) => {
      await trx
        .selectFrom("mailbox_settings")
        .select("mailbox_id")
        .where("org_id", "=", org.ctx.orgId)
        .where("mailbox_id", "=", org.mailboxId)
        .forUpdate()
        .execute();
      locked.resolve(undefined);
      await held.promise;
      await updateMailboxSettings(trx, org.ctx, org.mailboxId, {
        toolSwitches: { move: false, mark_read: false, flag: false, create_draft: false, move_unsure: false },
      });
    });
    await locked.promise;
    let finished = false;
    const tap = draftFollowUp({ db: connA, ...at }, org.ctx, input(org, loop.id)).then((result) => {
      finished = true;
      return result;
    });
    try {
      await sleep(80);
      expect(finished).toBe(false);
    } finally {
      // The setter must end also when the check fails, or its open transaction blocks the clean-up of the organization.
      held.resolve(undefined);
    }
    await setter;
    expect(await withTimeout(tap, 8_000)).toEqual({ kind: "drafts_off" });
    expect(await actionsOfLoop(app, loop.id)).toEqual([]);
  }, 20_000);
});

const switchOff = (conn: Db | Transaction<DB>, org: CommandOrg) =>
  setSentSync(conn, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks);

const openLoopsOf = async (org: CommandOrg) =>
  app
    .selectFrom("open_loops")
    .select("id")
    .where("org_id", "=", org.ctx.orgId)
    .where("mailbox_id", "=", org.mailboxId)
    .where("status", "=", "open")
    .execute();

describe.each(pairs)("Reopen against the Sent switch off (%s)", (_name, connA, connB) => {
  test("a switch-off that is not committed yet makes Reopen wait; Reopen then sees tracking off and opens nothing", async () => {
    const org = await newOrg();
    const loop = await loopIn(org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
    const held = Promise.withResolvers<undefined>();
    const switched = Promise.withResolvers<undefined>();
    const off = connB.transaction().execute(async (trx) => {
      await switchOff(trx, org);
      switched.resolve(undefined);
      await held.promise;
    });
    await switched.promise;
    let finished = false;
    const reopen = reopenLoop({ db: connA, ...at }, org.ctx, input(org, loop.id)).then((result) => {
      finished = true;
      return result;
    });
    try {
      await sleep(80);
      // Without the lock on the Sent state row, Reopen reads "on", opens the loop and commits at once.
      expect(finished).toBe(false);
    } finally {
      held.resolve(undefined);
    }
    await off;
    expect(await withTimeout(reopen, 8_000)).toEqual({ kind: "not_allowed" });
    expect(await openLoopsOf(org)).toEqual([]);
    expect((await getSentSyncState(app, org.ctx, org.mailboxId))?.enabled).toBe(false);
  }, 20_000);

  test(
    `${ROUNDS} loops, both at once: tracking off never leaves an open loop, and a loop is never open with texts cleared`,
    async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const org = await newOrg();
        const loop = await loopIn(org, { status: "closed", close_reason: "done", closed_at: FRIDAY });
        const [reopened] = await withTimeout(
          Promise.all([
            reopenLoop({ db: connA, ...at }, org.ctx, input(org, loop.id)),
            jitter().then(() => switchOff(connB, org)),
          ]),
          8_000
        );
        expect(["ok", "not_allowed"]).toContain(reopened.kind);
        const state = await getSentSyncState(app, org.ctx, org.mailboxId);
        expect(state?.enabled).toBe(false);
        const row = await loopOf(app, loop.id);
        // Reopen first: the switch-off then closes the loop `sent_off` and clears it. Switch-off first: Reopen is refused.
        if (reopened.kind === "ok") expect([row.status, row.close_reason]).toEqual(["closed", "sent_off"]);
        else expect(row.status).toBe("closed");
        expect(await openLoopsOf(org)).toEqual([]);
      }
    },
    MINUTE_MS
  );
});
