// The brief on real connections. Committed rows; the organizations and users are deleted at the end.
// Each case runs on the app role, on the table owner (it has no row level security, so only the org filters of the queries
// hold) and on a mix of both. The rules under test:
//   1. the first digest of a member's local day is one (a second digest of the day, queued at the same time, has no brief);
//   2. a ⌛ line is named once (two members' digests at the same time: one has it);
//   3. `surfaced_at` and `stale_notified_at` keep the time of the digest that committed first;
//   4. one digest per member and slot (two job processes);
//   5. "Track my sent mail" off and a digest that names a loop of the mailbox leave no copy of the loop in either order.
import { randomUUID } from "node:crypto";

import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { isFirstDigestOfDay, queueDigest, scheduleDigests } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setSentSync } from "../../src/modules/mail";
import { createDb, type Db, type DB } from "../../src/platform/db";

import { briefOrg, EIGHT, waitingLoop, type BriefOrg } from "./channels-digest-brief-fixtures";
import { addMember } from "./fixtures";
import { linkChat, randomChatId } from "./fixtures";
import { consentRow, CURRENT_CONSENT } from "./follow-up-fixtures";
import { testDb } from "./helpers";
import { FRIDAY } from "./loops-commands-fixtures";
import { insertLoopRow } from "./loops-fixtures";

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

const ROUNDS = 10;
const pairs: [string, Db, Db][] = [
  ["app role", app, appB],
  ["table owner", owner, ownerB],
  ["app role and table owner", app, ownerB],
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (max = 12) => sleep(Math.floor(Math.random() * max));
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timeout: a deadlock?")), ms)),
  ]);

async function newOrg(opts: { members?: number } = {}): Promise<BriefOrg & { memberIds: string[] }> {
  const org = await app.transaction().execute(async (trx) => {
    const created = await briefOrg(trx);
    const memberIds: string[] = [];
    for (let i = 0; i < (opts.members ?? 0); i += 1) {
      // Owners: only an owner gets the ⌛ line, and this test is about two digests that both may take it.
      const id = await addMember(trx, created.ctx.orgId, "owner");
      await linkChat(trx, created.ctx, id, randomChatId(), new Date("2026-11-05T20:00:00Z"));
      await consentRow(trx, created.ctx.orgId, id, CURRENT_CONSENT, new Date("2026-11-06T00:00:00Z"));
      memberIds.push(id);
    }
    return { ...created, memberIds };
  });
  orgs.push(org.ctx.orgId);
  users.push(org.userId, org.memberId, ...org.memberIds);
  return org;
}

const linkOf = (org: BriefOrg, userId: string) => ({
  orgId: org.ctx.orgId,
  userId,
  role: "owner" as const,
  chatId: org.chatId,
  linkedAt: new Date("2026-11-05T20:00:00Z"),
  locale: "en" as const,
});

const slotAt = (key: string) => ({ key, date: key.slice(0, 10), time: key.slice(11) });
const inputAt = (now: Date, key: string) => ({
  slot: slotAt(key),
  periodStart: new Date(now.getTime() - DAY_MS),
  now,
  timeZone: "Europe/Warsaw",
  testMail: NO_TEST_SENDERS,
  webBaseUrl: undefined,
});

const digestRows = (org: BriefOrg) =>
  app
    .selectFrom("outbox")
    .select(["id", "user_id", "status", "text", "view", "created_at", "dedup_key"])
    .where("org_id", "=", org.ctx.orgId)
    .where("kind", "=", "digest")
    .orderBy("created_at")
    .execute();
const textOf = (row: { text: string | null; view: unknown }) => row.text ?? (row.view as { text?: string }).text ?? "";

describe.each(pairs)("the first digest of the day is one (%s)", (_name, connA, connB) => {
  test(`${ROUNDS} days: two queue transactions of one member at once, at different slots: exactly one is the first`, async () => {
    const org = await newOrg();
    for (let i = 0; i < ROUNDS; i += 1) {
      const day = String(1 + i).padStart(2, "0");
      const queueAt = async (conn: Db, key: string, at: string) =>
        withTimeout(
          conn.transaction().execute(async (trx) => {
            const first = await isFirstDigestOfDay(trx, org.ctx, {
              userId: org.userId,
              slotDate: key.slice(0, 10),
            });
            // The window between the decision and the outbox row: without the lock the other transaction decides here too.
            await sleep(25);
            const digest = await trx
              .insertInto("digests")
              .values({
                org_id: org.ctx.orgId,
                user_id: org.userId,
                slot_key: key,
                period_start: new Date("2026-11-19T00:00:00Z"),
                period_end: new Date(at),
              })
              .returning("id")
              .executeTakeFirstOrThrow();
            await trx
              .insertInto("outbox")
              .values({
                org_id: org.ctx.orgId,
                user_id: org.userId,
                kind: "digest",
                dedup_key: `digest:${key}`,
                digest_id: digest.id,
                view: JSON.stringify({ text: "x", buttons: [] }),
                buttons: "[]",
                created_at: new Date(at),
                next_attempt_at: new Date(at),
              })
              .execute();
            return first;
          }),
          8_000
        );
      const results = await Promise.all([
        queueAt(connA, `2026-12-${day}T08:00`, `2026-12-${day}T07:00:00Z`),
        jitter(8).then(() => queueAt(connB, `2026-12-${day}T16:00`, `2026-12-${day}T15:00:00Z`)),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  }, 40_000);

  test(
    `${ROUNDS} orgs: two job processes at once: one digest row, one outbox row, one brief`,
    async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const org = await newOrg();
        const loop = await app.transaction().execute((trx) => waitingLoop(trx, org));
        await withTimeout(
          Promise.all([
            scheduleDigests({ db: connA, now: () => new Date(EIGHT), testMail: NO_TEST_SENDERS }),
            jitter().then(() =>
              scheduleDigests({ db: connB, now: () => new Date(Date.parse(EIGHT) + 1000), testMail: NO_TEST_SENDERS })
            ),
          ]),
          15_000
        );
        const rows = await digestRows(org);
        expect(rows).toHaveLength(1);
        expect(textOf(rows[0] ?? { text: null, view: {} })).toContain("📌 NEEDS YOU TODAY");
        const digests = await app.selectFrom("digests").select("id").where("org_id", "=", org.ctx.orgId).execute();
        expect(digests).toHaveLength(1);
        // The mark carries the time of the digest that committed: the `created_at` of the one outbox row.
        const marked = await app
          .selectFrom("open_loops")
          .select("surfaced_at")
          .where("id", "=", loop)
          .executeTakeFirstOrThrow();
        expect(marked.surfaced_at?.toISOString()).toBe(rows[0]?.created_at.toISOString());
      }
    },
    MINUTE_MS
  );
});

describe.each(pairs)("a ⌛ line is named once and the marks keep the first time (%s)", (_name, connA, connB) => {
  test(
    `${ROUNDS} orgs: two members' digests at once: one has the ⌛ line, both the waiting line, the marks are one time`,
    async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const org = await newOrg({ members: 1 });
        const second = org.memberIds[0] ?? "";
        const ids = await app.transaction().execute(async (trx) => ({
          waiting: await waitingLoop(trx, org),
          stale: await insertLoopRow(trx, org.ctx, org.mailboxId, {
            status: "closed",
            close_reason: "stale",
            closed_at: new Date("2026-11-19T10:00:00Z"),
            subject: "Old offer",
            due_at: new Date("2026-10-01T10:00:00Z"),
          }),
        }));
        const a = new Date(EIGHT);
        const b = new Date(Date.parse(EIGHT) + 1000);
        await withTimeout(
          Promise.all([
            queueDigest(connA, linkOf(org, org.userId), inputAt(a, "2026-11-20T08:00")),
            jitter().then(() => queueDigest(connB, linkOf(org, second), inputAt(b, "2026-11-20T08:00"))),
          ]),
          15_000
        );
        const rows = await digestRows(org);
        expect(rows).toHaveLength(2);
        const texts = rows.map(textOf);
        expect(texts.filter((text) => text.includes("⌛ Closed without an answer: Old offer"))).toHaveLength(1);
        expect(texts.every((text) => text.includes("⏳ No answer from anna@example.test"))).toBe(true);
        const marks = await app
          .selectFrom("open_loops")
          .select(["id", "surfaced_at", "stale_notified_at"])
          .where("org_id", "=", org.ctx.orgId)
          .execute();
        const waiting = marks.find((row) => row.id === ids.waiting);
        const stale = marks.find((row) => row.id === ids.stale);
        // The digest that committed first named the stale loop and set both marks; the second left them as they were.
        const first = rows.find((row) => textOf(row).includes("⌛"));
        expect(stale?.stale_notified_at?.toISOString()).toBe(first?.created_at.toISOString());
        expect(waiting?.surfaced_at?.toISOString()).toBe(first?.created_at.toISOString());
      }
    },
    MINUTE_MS
  );
});

describe.each(pairs)("Sent tracking off against a digest that names a loop (%s)", (_name, connA, connB) => {
  const scan = async (needles: readonly string[]): Promise<string[]> => {
    const { rows: tables } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`.execute(
      app
    );
    const found: string[] = [];
    for (const { table_name: name } of tables) {
      for (const needle of needles) {
        const { rows } = await sql<{ n: string }>`
          select count(*) as n from ${sql.table(name)} t where t::text like ${`%${needle}%`}`.execute(app);
        if (Number(rows[0]?.n ?? 0) > 0) {
          found.push(name);
          break;
        }
      }
    }
    return found.sort();
  };

  test(`${ROUNDS} orgs: whichever commits first, no copy of the loop is left in any table`, async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const org = await newOrg();
      const id = randomUUID().slice(0, 8);
      const planted = [`who-${id}@race.example.test`, `SUBJECT-${id}`, `ASK-${id}`];
      await app.transaction().execute((trx) =>
        waitingLoop(trx, org, {
          counterpart: planted[0] ?? "",
          to_addresses: [planted[0] ?? ""],
          subject: planted[1] ?? "",
          text: planted[2] ?? "",
        })
      );
      await withTimeout(
        Promise.all([
          queueDigest(connA, linkOf(org, org.userId), inputAt(new Date(EIGHT), "2026-11-20T08:00")),
          jitter(30).then(() =>
            connB
              .transaction()
              .execute((trx: Transaction<DB>) =>
                setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks)
              )
          ),
        ]),
        15_000
      );
      expect(await scan(planted)).toEqual([]);
      const loops = await app
        .selectFrom("open_loops")
        .select("status")
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      expect(loops.every((loop) => loop.status === "closed")).toBe(true);
    }
  }, 90_000);
});
