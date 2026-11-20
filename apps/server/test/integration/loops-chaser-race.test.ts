// The chaser on real connections. Committed rows; the organizations and users are deleted at the end. Each case
// runs on the app role, on the table owner (it has no row level security, so only the org filters of the queries hold) and on a
// mix of both. The rules under test: a mailbox acts once per local day (two chasers at once give one run); one follow-up waits
// at a time (the chaser and a tap at once give one pair); a loop closes once (the chaser and Done at once give one close row and
// no card on a closed loop); the Sent switch off wins over the chaser (no copy of the Sent mail is left, no open loop); a
// settings change that commits before the run's lock stops the run.
import { parseToolSwitches, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { lockMailboxSettings, updateMailboxSettings } from "../../src/modules/config";
import { getMailboxSettings } from "../../src/modules/config";
import { runChaserForMailbox } from "../../src/modules/delegation";
import { doneLoop, draftFollowUp } from "../../src/modules/loops";
import { setSentSync } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createDb, type Db, type DB } from "../../src/platform/db";

import { openDelegation } from "./delegation-chaser-fixtures";
import { testDb } from "./helpers";
import {
  chase,
  DAY_MS,
  delegatedLoop,
  DUE_YESTERDAY,
  loopSends,
  markers,
  NOW,
  priorFollowUp,
} from "./loops-chaser-fixtures";
import { actionsOfLoop, auditOf, commandOrg, loopOf, type CommandOrg } from "./loops-commands-fixtures";

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

const ROUNDS = 8;
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

const delegated = (org: CommandOrg, over: Parameters<typeof delegatedLoop>[2] = {}) =>
  app.transaction().execute((trx: Transaction<DB>) => delegatedLoop(trx, org, over));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = () => sleep(Math.floor(Math.random() * 6));
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timeout: a deadlock?")), ms)),
  ]);

describe.each(pairs)("two chasers at once (%s)", (_name, connA, connB) => {
  test(
    `${ROUNDS} mailboxes: one run per part, one pair per loop, one reminder set`,
    async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const org = await newOrg();
        const loops = await Promise.all([delegated(org), delegated(org), delegated(org)]);
        await app.transaction().execute((trx) => openDelegation(trx, org, { dueAt: DUE_YESTERDAY }));
        const results = await withTimeout(
          Promise.all([chase(connA, org), jitter().then(() => chase(connB, org))]),
          10_000
        );
        expect(results.map((result) => result.skipped ?? "ran").sort()).toEqual(["gate", "ran"]);
        expect(await markers(app, org.ctx.orgId, "loops.chaser_run")).toHaveLength(1);
        expect(await markers(app, org.ctx.orgId, "delegation.chaser_run")).toHaveLength(1);
        for (const loop of loops) {
          expect((await actionsOfLoop(app, loop.id)).map((row) => `${row.type}:${row.status}`)).toEqual([
            "create_draft:ready",
            "send:awaiting_approval",
          ]);
        }
        const reminders = await app
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", org.ctx.orgId)
          .where("idempotency_key", "like", "%:reminder:%")
          .execute();
        expect(reminders).toHaveLength(2);
        expect(await auditOf(app, org.ctx.orgId, "action.planned")).toHaveLength(6);
      }
    },
    MINUTE_MS
  );
});

describe.each(pairs)("the chaser and a Draft tap at once (%s)", (_name, connA, connB) => {
  test(
    `${ROUNDS} loops: one pair, planned once, by one of them`,
    async () => {
      const org = await newOrg();
      for (let i = 0; i < ROUNDS; i += 1) {
        const loop = await delegated(org);
        const [run, tap] = await withTimeout(
          Promise.all([
            chase(connA, org, new Date(NOW.getTime() + i * DAY_MS), { force: true }),
            jitter().then(() =>
              draftFollowUp({ db: connB, now: () => NOW }, org.ctx, { loopId: loop.id, userId: org.userId, via: "web" })
            ),
          ]),
          10_000
        );
        const plannedBy = (run.followUps > 0 ? 1 : 0) + (tap.kind === "planned" ? 1 : 0);
        // Another loop of an earlier round may be planned by this run too: only this loop counts.
        const rows = await actionsOfLoop(app, loop.id);
        expect(rows.map((row) => `${row.type}:${row.status}`)).toEqual([
          "create_draft:ready",
          "send:awaiting_approval",
        ]);
        expect(tap.kind === "planned" || tap.kind === "waiting").toBe(true);
        expect(plannedBy).toBeGreaterThanOrEqual(1);
        const planned = (await auditOf(app, org.ctx.orgId, "action.planned")).filter(
          (row) => (row.data as Record<string, unknown>).loop_id === loop.id
        );
        expect(planned).toHaveLength(2);
      }
    },
    MINUTE_MS
  );
});

describe.each(pairs)("the chaser and Done at once (%s)", (_name, connA, connB) => {
  test(
    `${ROUNDS} stale loops with a waiting card: one close row, the card expired`,
    async () => {
      const org = await newOrg();
      for (let i = 0; i < ROUNDS; i += 1) {
        const loop = await delegated(org, { due_at: new Date(NOW.getTime() - 31 * DAY_MS) });
        const card = await app
          .transaction()
          .execute((trx) => priorFollowUp(trx, org, loop.id, { status: "awaiting_approval" }));
        await withTimeout(
          Promise.all([
            chase(connA, org, new Date(NOW.getTime() + i * DAY_MS), { force: true }),
            jitter().then(() =>
              doneLoop({ db: connB, now: () => NOW }, org.ctx, { loopId: loop.id, userId: org.userId, via: "web" })
            ),
          ]),
          10_000
        );
        const row = await loopOf(app, loop.id);
        expect(row.status).toBe("closed");
        expect(["stale", "done"]).toContain(row.close_reason ?? "");
        const closes = (await auditOf(app, org.ctx.orgId, "loop.closed")).filter(
          (entry) => (entry.data as Record<string, unknown>).loop_id === loop.id
        );
        expect(closes).toHaveLength(1);
        const send = (await loopSends(app, org.ctx.orgId)).find((entry) => entry.id === card.sendId);
        expect(send).toMatchObject({ status: "expired", status_reason: "loop_closed" });
      }
    },
    MINUTE_MS
  );

  test(
    `${ROUNDS} due loops: a loop that Done closed has no waiting card`,
    async () => {
      const org = await newOrg();
      for (let i = 0; i < ROUNDS; i += 1) {
        const loop = await delegated(org);
        await withTimeout(
          Promise.all([
            chase(connA, org, new Date(NOW.getTime() + i * DAY_MS), { force: true }),
            jitter().then(() =>
              doneLoop({ db: connB, now: () => NOW }, org.ctx, { loopId: loop.id, userId: org.userId, via: "web" })
            ),
          ]),
          10_000
        );
        const row = await loopOf(app, loop.id);
        expect([row.status, row.close_reason]).toEqual(["closed", "done"]);
        const live = (await actionsOfLoop(app, loop.id)).filter(
          (entry) =>
            ["awaiting_approval", "approved", "applying", "ready"].includes(entry.status) && entry.type === "send"
        );
        expect(live).toEqual([]);
      }
    },
    MINUTE_MS
  );
});

describe.each(pairs)("the chaser and the Sent switch off at once (%s)", (_name, connA, connB) => {
  test(
    `${ROUNDS} mailboxes: no open loop and no copy of the Sent mail is left`,
    async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const org = await newOrg();
        const loop = await delegated(org);
        await withTimeout(
          Promise.all([
            chase(connA, org),
            jitter().then(() =>
              setSentSync(connB, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: NOW }, sentSwitchHooks)
            ),
          ]),
          10_000
        );
        const row = await loopOf(app, loop.id);
        expect([row.status, row.close_reason]).toEqual(["closed", "sent_off"]);
        for (const send of await actionsOfLoop(app, loop.id)) {
          expect(send.status === "expired" || send.status === "ready").toBe(true);
          for (const key of ["quote", "to", "cc", "subject"]) expect(send.payload as object).not.toHaveProperty(key);
        }
      }
    },
    MINUTE_MS
  );
});

describe.each(pairs)("a settings change before the run's lock (%s)", (_name, connA, connB) => {
  test("T11 the setter holds the settings row: the run waits, sees the new version and writes nothing", async () => {
    const org = await newOrg();
    const loop = await delegated(org);
    await app.transaction().execute((trx) => openDelegation(trx, org, { dueAt: DUE_YESTERDAY }));
    let run: ReturnType<typeof chase> | undefined;
    let done = false;
    await connB.transaction().execute(async (trx) => {
      await lockMailboxSettings(trx, org.ctx, org.mailboxId);
      await updateMailboxSettings(trx, org.ctx, org.mailboxId, {
        toolSwitches: { ...parseToolSwitches({}), create_draft: false },
      });
      run = chase(connA, org);
      void run.then(() => {
        done = true;
      });
      await sleep(250);
      expect(done).toBe(false);
    });
    // The run read the old version first; after the setter's commit the version differs.
    expect((await run)?.skipped).toBe("settings");
    expect(await actionsOfLoop(app, loop.id)).toEqual([]);
    expect(await markers(app, org.ctx.orgId, "loops.chaser_run")).toEqual([]);
    expect(await markers(app, org.ctx.orgId, "delegation.chaser_run")).toEqual([]);
  }, 20_000);
});

describe.each(pairs)("two runs of the delegation wrapper at once (%s)", (_name, connA, connB) => {
  test(
    `${ROUNDS} mailboxes: one run, one marker, one reminder`,
    async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const org = await newOrg();
        await app.transaction().execute((trx) => openDelegation(trx, org, { dueAt: DUE_YESTERDAY }));
        const settings = await getMailboxSettings(app, org.ctx, org.mailboxId);
        if (settings === undefined) throw new Error("no settings");
        const mailbox = { id: org.mailboxId, timezone: "Europe/Warsaw", settingsVersion: settings.version };
        const results = await withTimeout(
          Promise.all([
            runChaserForMailbox({ db: connA, now: () => NOW }, org.ctx, mailbox, NOW),
            jitter().then(() => runChaserForMailbox({ db: connB, now: () => NOW }, org.ctx, mailbox, NOW)),
          ]),
          10_000
        );
        expect(results.map((result) => result.skipped ?? "ran").sort()).toEqual(["gate", "ran"]);
        expect(await markers(app, org.ctx.orgId, "delegation.chaser_run")).toHaveLength(1);
        const reminders = await app
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", org.ctx.orgId)
          .where("idempotency_key", "like", "%:reminder:%")
          .execute();
        expect(reminders).toHaveLength(2);
      }
    },
    MINUTE_MS
  );
});

// The flag is read again under the lock; another organization's loops stay out of the run.
describe.each(pairs)("the flag turned off while the run waits for the settings lock (%s)", (_name, connA, connB) => {
  test("the delegation part runs, the loop part writes nothing and no loop marker", async () => {
    const org = await newOrg();
    const stale = await delegated(org, { due_at: new Date(NOW.getTime() - 31 * DAY_MS) });
    const due = await delegated(org);
    await app.transaction().execute((trx) => openDelegation(trx, org, { dueAt: DUE_YESTERDAY }));
    let run: ReturnType<typeof chase> | undefined;
    await connB.transaction().execute(async (trx) => {
      // The setter holds the settings row and turns the flag off; it changes no setting, so the version stays.
      await lockMailboxSettings(trx, org.ctx, org.mailboxId);
      await setOrgFeature(trx, org.ctx, { flag: "open_loops", enabled: false, actor: "test", now: NOW });
      run = chase(connA, org);
      await sleep(250);
    });
    expect(await run).toMatchObject({ skipped: null, reminders: 1, followUps: 0, stale: 0 });
    expect((await loopOf(app, stale.id)).status).toBe("open");
    expect(await actionsOfLoop(app, due.id)).toEqual([]);
    expect(await markers(app, org.ctx.orgId, "loops.chaser_run")).toEqual([]);
    expect(await markers(app, org.ctx.orgId, "delegation.chaser_run")).toHaveLength(1);
  }, 20_000);
});

describe("a second organization on the table owner", () => {
  test("the run of one organization touches no loop and no marker of the other", async () => {
    const mine = await newOrg();
    const theirs = await newOrg();
    const own = await delegated(mine);
    const foreignStale = await delegated(theirs, { due_at: new Date(NOW.getTime() - 40 * DAY_MS) });
    const foreignDue = await delegated(theirs);
    await chase(owner, mine);
    expect((await actionsOfLoop(app, own.id)).length).toBe(2);
    expect((await loopOf(app, foreignStale.id)).status).toBe("open");
    expect(await actionsOfLoop(app, foreignDue.id)).toEqual([]);
    expect(await markers(app, theirs.ctx.orgId, "loops.chaser_run")).toEqual([]);
  });
});
