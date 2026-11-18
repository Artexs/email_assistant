import { randomUUID } from "node:crypto";

import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { deleteEndedSuggestions, deleteOldProfiles } from "../../src/modules/contacts";
import { setOrgFeature } from "../../src/modules/tenancy";
import {
  PROFILE_RETENTION_DAYS,
  createRetentionJob,
  SUGGESTION_ENDED_DAYS,
  SUGGESTION_OPEN_DAYS,
} from "../../src/retention";

import { newOrg, NOW, type Org, type Trx } from "./contacts-fixtures";
import { testDb, withRollback } from "./helpers";

// Retention of the sender context: a profile goes 365 days after the newest date it holds, an ended suggestion 90 days
// after its end, and an open one that nobody answered ends as `expired` after 30 days. The flags decide nothing here.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const hash = (): string => randomUUID().replaceAll("-", "").repeat(2);
const daysAgo = (days: number, plusMs = 0): Date => new Date(NOW.getTime() - days * DAY_MS + plusMs);
const BEFORE = daysAgo(PROFILE_RETENTION_DAYS);

const profile = async (
  trx: Trx,
  org: Org,
  over: { seen?: Date | null; user?: Date | null; refreshed?: Date; received?: number; delegations?: number } = {}
): Promise<string> => {
  const key = hash();
  await trx
    .insertInto("sender_profiles")
    .values({
      org_id: org.ctx.orgId,
      mailbox_id: org.mailboxId,
      key_hash: key,
      relation: "known",
      received: over.received ?? 0,
      delegations_to: over.delegations ?? 0,
      last_seen_at: over.seen === undefined ? null : over.seen,
      last_user_mail_at: over.user === undefined ? null : over.user,
      ...(over.refreshed === undefined ? {} : { refreshed_at: over.refreshed }),
    })
    .execute();
  return key;
};

const keysOf = async (trx: Trx, org: Org): Promise<string[]> =>
  (await trx.selectFrom("sender_profiles").select("key_hash").where("org_id", "=", org.ctx.orgId).execute())
    .map((row) => row.key_hash)
    .sort();

const suggestion = async (
  trx: Trx,
  org: Org,
  over: {
    status?: "open" | "dismissed" | "accepted" | "withdrawn" | "expired";
    created?: Date;
    ended?: Date | null;
  } = {}
): Promise<string> => {
  const status = over.status ?? "open";
  const row = await trx
    .insertInto("sender_suggestions")
    .values({
      org_id: org.ctx.orgId,
      mailbox_id: org.mailboxId,
      key_hash: hash(),
      scope: "address",
      kind: "vip",
      status,
      pattern: status === "open" ? "anna@acme.pl" : null,
      created_at: over.created ?? daysAgo(1),
      ended_at: status === "open" ? null : (over.ended ?? NOW),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
};

const suggestionOf = (trx: Trx, id: string) =>
  trx.selectFrom("sender_suggestions").selectAll().where("id", "=", id).executeTakeFirst();

const runProfiles = (trx: Trx, org: Org, opts: { batch?: number } = {}) =>
  deleteOldProfiles(trx, org.ctx, { before: BEFORE, ...opts });
const runSuggestions = (trx: Trx, org: Org, opts: { batch?: number } = {}) =>
  deleteEndedSuggestions(trx, org.ctx, {
    before: daysAgo(SUGGESTION_ENDED_DAYS),
    openBefore: daysAgo(SUGGESTION_OPEN_DAYS),
    now: NOW,
    ...opts,
  });

describe("retention of sender profiles", () => {
  test("1 a profile whose last mail is 366 days old goes; one of 364 days stays", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await profile(trx, org, { seen: daysAgo(366) });
      const young = await profile(trx, org, { seen: daysAgo(364) });
      expect(await runProfiles(trx, org)).toBe(1);
      expect(await keysOf(trx, org)).toEqual([young]);
      expect(old).not.toBe(young);
      // The edge: exactly 365 days old stays (the rule is "older than").
      const edge = await profile(trx, org, { seen: daysAgo(365) });
      expect(await runProfiles(trx, org)).toBe(0);
      expect(await keysOf(trx, org)).toEqual([edge, young].sort());
      const justOver = await profile(trx, org, { seen: daysAgo(365, -1000) });
      expect(await runProfiles(trx, org)).toBe(1);
      expect(await keysOf(trx, org)).not.toContain(justOver);
    });
  });

  test("2 the age is the newest of the two dates: a Sent mail of 10 days keeps a contact whose own mail is 400 days old", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const kept = await profile(trx, org, { seen: daysAgo(400), user: daysAgo(10) });
      const userOnlyOld = await profile(trx, org, { user: daysAgo(400) });
      const userOnlyYoung = await profile(trx, org, { user: daysAgo(100) });
      const seenYoungUserOld = await profile(trx, org, { seen: daysAgo(100), user: daysAgo(500) });
      expect(await runProfiles(trx, org)).toBe(1);
      const left = await keysOf(trx, org);
      expect(left).toEqual([kept, userOnlyYoung, seenYoungUserOld].sort());
      expect(left).not.toContain(userOnlyOld);
    });
  });

  test("3 `refreshed_at` is the last change, not an age: a row with fresh dates stays whatever it says, an old one goes whatever it says", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const stale = await profile(trx, org, { seen: daysAgo(2), refreshed: daysAgo(500), delegations: 3, received: 4 });
      const fresh = await profile(trx, org, { seen: daysAgo(500), refreshed: daysAgo(1) });
      expect(await runProfiles(trx, org)).toBe(1);
      expect(await keysOf(trx, org)).toEqual([stale]);
      expect(fresh).not.toBe(stale);
    });
  });

  test("4 a row cannot have no date: the table CHECK is what makes the age rule complete", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await sql`SAVEPOINT no_dates`.execute(trx);
      await expect(profile(trx, org, { delegations: 2 })).rejects.toMatchObject({
        constraint: "sender_profiles_dates_check",
      });
      await sql`ROLLBACK TO SAVEPOINT no_dates`.execute(trx);
    });
  });

  test("5 the other organization's rows stay; a repeat run changes nothing; batches of 2 delete all", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      for (let i = 0; i < 5; i += 1) await profile(trx, a, { seen: daysAgo(400 + i) });
      const bKeep = await profile(trx, b, { seen: daysAgo(500) });
      expect(await runProfiles(trx, a, { batch: 2 })).toBe(5);
      expect(await keysOf(trx, a)).toEqual([]);
      expect(await keysOf(trx, b)).toEqual([bKeep]);
      expect(await runProfiles(trx, a)).toBe(0);
    });
  });

  test("6 the flags decide nothing: the rows of an organization with `sender_context` off go too", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      await setOrgFeature(trx, org.ctx, { flag: "sender_context", enabled: false, actor: "cli", now: NOW });
      await profile(trx, org, { seen: daysAgo(500) });
      const out = await createRetentionJob({ db: trx, now: () => NOW }).runOrg(
        { id: org.ctx.orgId, dataRetentionDays: 30 },
        NOW
      );
      expect(out.profiles).toBe(1);
      expect(await keysOf(trx, org)).toEqual([]);
    });
  });
});

describe("retention of rule suggestions", () => {
  test("1 a dismissed suggestion ended 91 days ago goes; one ended 89 days ago stays (it still hides its key)", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await suggestion(trx, org, { status: "dismissed", ended: daysAgo(91) });
      const young = await suggestion(trx, org, { status: "dismissed", ended: daysAgo(89) });
      expect(await runSuggestions(trx, org)).toBe(1);
      expect(await suggestionOf(trx, old)).toBeUndefined();
      expect(await suggestionOf(trx, young)).toBeDefined();
    });
  });

  test("2 every ended status goes after 90 days: accepted, withdrawn and expired too", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const ids = [];
      for (const status of ["accepted", "withdrawn", "expired", "dismissed"] as const) {
        ids.push(await suggestion(trx, org, { status, ended: daysAgo(100) }));
      }
      expect(await runSuggestions(trx, org)).toBe(4);
      for (const id of ids) expect(await suggestionOf(trx, id)).toBeUndefined();
    });
  });

  test("3 an open suggestion 31 days old ends as expired with no pattern; one of 29 days stays open", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const old = await suggestion(trx, org, { created: daysAgo(31) });
      const young = await suggestion(trx, org, { created: daysAgo(29) });
      expect(await runSuggestions(trx, org)).toBe(1);
      const ended = await suggestionOf(trx, old);
      expect(ended?.status).toBe("expired");
      expect(ended?.pattern).toBeNull();
      expect(ended?.ended_at?.getTime()).toBe(NOW.getTime());
      const open = await suggestionOf(trx, young);
      expect(open?.status).toBe("open");
      expect(open?.pattern).toBe("anna@acme.pl");
      // The expired row is not deleted in the same run (its end is now), and a repeat run changes nothing.
      expect(await runSuggestions(trx, org)).toBe(0);
    });
  });

  test("4 the other organization's rows stay; batches of 2 handle every row", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      for (let i = 0; i < 3; i += 1) await suggestion(trx, a, { created: daysAgo(40 + i) });
      for (let i = 0; i < 3; i += 1) await suggestion(trx, a, { status: "dismissed", ended: daysAgo(95 + i) });
      const bOpen = await suggestion(trx, b, { created: daysAgo(40) });
      const bEnded = await suggestion(trx, b, { status: "dismissed", ended: daysAgo(95) });
      expect(await runSuggestions(trx, a, { batch: 2 })).toBe(6);
      expect((await suggestionOf(trx, bOpen))?.status).toBe("open");
      expect(await suggestionOf(trx, bEnded)).toBeDefined();
      const left = await trx
        .selectFrom("sender_suggestions")
        .select("status")
        .where("org_id", "=", a.ctx.orgId)
        .execute();
      expect(left.map((row) => row.status)).toEqual(["expired", "expired", "expired"]);
    });
  });

  test("5 the flags decide nothing: the retention run of an organization with every flag off clears both tables", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      await profile(trx, org, { seen: daysAgo(400) });
      const open = await suggestion(trx, org, { created: daysAgo(40) });
      const out = await createRetentionJob({ db: trx, now: () => NOW }).runOrg(
        { id: org.ctx.orgId, dataRetentionDays: 30 },
        NOW
      );
      expect(out.profiles).toBe(1);
      expect(out.suggestions).toBe(1);
      expect((await suggestionOf(trx, open))?.status).toBe("expired");
    });
  });
});
