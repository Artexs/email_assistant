// The stored digest is a new copy of loop data (address, ask, subject in `outbox.text` and `outbox.view`). Every
// rule that removes loop data must reach it. The places that copy a value of a loop into a digest, and the rules that delete:
//   1. `outbox.text`, `outbox.view.text` of the `digest` row (the brief lines).  Removed by: the Sent switch off (`clearLoopCards`
//      finds the row by `view.loopIds`), the erase of a person (`blankDigestsNamingLoops`), retention (`clearOutboxTexts`, 90 days),
//      `delete_mailbox` and the erase of a mail (many-mails rule), the delete of the organization (cascade).
//   2. `open_loops.surfaced_at`, `stale_notified_at`: times, no text. Nothing to clear.
//   3. `audit_log`, logs: ids and codes only (the log test of this file).
//   4. The Telegram chat: a delivered message cannot be recalled.
// The last test of the Sent part scans every table for planted values, so a place that this list does not name fails it.
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { sentSwitchHooks } from "../../src/composition";
import { clearOutboxTexts } from "../../src/modules/channels";
import { setSentSync } from "../../src/modules/mail";
import { eraseSubjectData } from "../../src/modules/privacy";
import type { DB } from "../../src/platform/db";

import { briefOrg, EIGHT, runDigests, waitingLoop, type BriefOrg } from "./channels-digest-brief-fixtures";
import { isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { FRIDAY } from "./loops-commands-fixtures";
import { insertLoopRow } from "./loops-fixtures";
import { siblingMailbox } from "./mail-sent-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Marks {
  counterpart: string;
  subject: string;
  ask: string;
}
const marks = (): Marks => {
  const id = randomUUID().slice(0, 8);
  return { counterpart: `who-${id}@brief.example.test`, subject: `SUBJECT-${id}`, ask: `ASK-${id}` };
};
const values = (m: Marks): string[] => Object.values(m);

const loopOf = (trx: Transaction<DB>, org: BriefOrg, mailboxId: string, m: Marks, dueAt = "2026-11-19T09:00:00Z") =>
  waitingLoop(trx, org, {
    mailbox_id: mailboxId,
    counterpart: m.counterpart,
    to_addresses: [m.counterpart],
    subject: m.subject,
    text: m.ask,
    due_at: new Date(dueAt),
  });

const digestRows = (trx: Transaction<DB>, orgId: string) =>
  trx
    .selectFrom("outbox")
    .select(["id", "user_id", "status", "error_code", "text", "view", "dedup_key"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "digest")
    .orderBy("dedup_key")
    .execute();

// A pending row holds its text in the view only; a delivered row in `text`.
const textOf = (row: { text: string | null; view: unknown }): string =>
  row.text ?? (row.view as { text?: string }).text ?? "";

// A digest row of the member (the outbox check wants a `digests` row for a digest) with the given view.
async function insertDigestCopy(
  trx: Transaction<DB>,
  org: BriefOrg,
  key: string,
  view: object,
  status: string,
  text: string | null
): Promise<string> {
  const digest = await trx
    .insertInto("digests")
    .values({
      org_id: org.ctx.orgId,
      user_id: org.userId,
      slot_key: key,
      period_start: new Date("2026-11-19T00:00:00Z"),
      period_end: FRIDAY,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: org.ctx.orgId,
      user_id: org.userId,
      kind: "digest",
      dedup_key: `digest:${key}`,
      digest_id: digest.id,
      view: JSON.stringify(view),
      text,
      buttons: "[]",
      status,
      next_attempt_at: FRIDAY,
      created_at: FRIDAY,
      ...(status === "sent" ? { sent_at: FRIDAY } : status === "failed" ? { error_code: "blocked" } : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

const switchOff = (trx: Transaction<DB>, org: BriefOrg, mailboxId: string) =>
  setSentSync(trx, org.ctx, mailboxId, { enabled: false, actor: "test", at: FRIDAY }, sentSwitchHooks);

async function tablesHolding(trx: Transaction<DB>, needles: readonly string[]): Promise<string[]> {
  const { rows: tables } = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`.execute(
    trx
  );
  const found: string[] = [];
  for (const { table_name: name } of tables) {
    for (const needle of needles) {
      const { rows } = await sql<{ n: string }>`
        select count(*) as n from ${sql.table(name)} t where t::text like ${`%${needle}%`}`.execute(trx);
      if (Number(rows[0]?.n ?? 0) > 0) {
        found.push(name);
        break;
      }
    }
  }
  return found.sort();
}

describe("the Sent switch off reaches the stored digest", () => {
  test("a pending digest ends failed / outdated and blank; a sent and a failed one are blank; the loop ids go with the view", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      const m = marks();
      await loopOf(trx, org, org.mailboxId, m);
      await runDigests(trx, EIGHT);
      // A second and a third digest row of the same organization, one `sent`, one `failed`, both naming the loop.
      const [first] = await digestRows(trx, org.ctx.orgId);
      if (first === undefined) throw new Error("no digest");
      expect(textOf(first)).toContain(m.counterpart);
      const text = textOf(first);
      await insertDigestCopy(trx, org, "2026-11-19T08:00", first.view as object, "sent", text);
      await insertDigestCopy(trx, org, "2026-11-19T09:00", first.view as object, "failed", text);

      await switchOff(trx, org, org.mailboxId);

      const rows = await digestRows(trx, org.ctx.orgId);
      expect(rows).toHaveLength(3);
      for (const row of rows) expect([row.text, JSON.stringify(row.view)]).toEqual(["[removed]", "{}"]);
      expect(rows.find((row) => row.id === first.id)).toMatchObject({
        status: "failed",
        error_code: "outdated",
      });
      expect(rows.find((row) => row.dedup_key === "digest:2026-11-19T08:00")?.status).toBe("sent");
      expect(rows.find((row) => row.dedup_key === "digest:2026-11-19T09:00")).toMatchObject({
        status: "failed",
        error_code: "blocked",
      });
    });
  });

  test("a digest that names no loop of the mailbox keeps its text: another mailbox, a count line, another organization", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const other = await briefOrg(trx);
      const mine = marks();
      const theirs = marks();
      const strangers = marks();
      await loopOf(trx, org, org.mailboxId, mine);
      await loopOf(trx, other, other.mailboxId, strangers);
      await runDigests(trx, EIGHT);
      const ownDigest = (await digestRows(trx, org.ctx.orgId))[0];
      // The digest of the organization names the loop of the first mailbox only now; add one of the sibling and a second
      // organization-level digest that names only the sibling's loop.
      await loopOf(trx, org, sibling.mailboxId, theirs);
      await runDigests(trx, "2026-11-20T15:00:00Z");
      expect((await digestRows(trx, org.ctx.orgId)).map((row) => row.dedup_key)).toHaveLength(2);
      const siblingLoop = await trx
        .selectFrom("open_loops")
        .select("id")
        .where("mailbox_id", "=", sibling.mailboxId)
        .executeTakeFirstOrThrow();
      const siblingOnly = await insertDigestCopy(
        trx,
        org,
        "2026-11-19T10:00",
        { text: `lines ${theirs.counterpart}`, buttons: [], loopIds: [siblingLoop.id] },
        "pending",
        null
      );

      await switchOff(trx, org, org.mailboxId);

      const rows = await digestRows(trx, org.ctx.orgId);
      // The digest of the first slot named the loop of the first mailbox: blank. The count line of the later slot named none.
      expect(rows.find((row) => row.id === ownDigest?.id)).toMatchObject({ text: "[removed]", status: "failed" });
      const later = rows.find((row) => row.dedup_key.endsWith("T16:00"));
      expect(later?.status).toBe("pending");
      expect(textOf(later ?? { text: null, view: {} })).not.toContain("[removed]");
      const keep = rows.find((row) => row.id === siblingOnly);
      expect(keep?.status).toBe("pending");
      expect(textOf(keep ?? { text: null, view: {} })).toBe(`lines ${theirs.counterpart}`);
      const foreign = await digestRows(trx, other.ctx.orgId);
      expect(foreign[0]?.status).toBe("pending");
      expect(textOf(foreign[0] ?? { text: null, view: {} })).toContain(strangers.counterpart);
    });
  });

  test("a view whose loopIds is not a list of ids names no loop: a scalar, an object key, a nested list, an upper-case id", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      const loop = await loopOf(trx, org, org.mailboxId, marks());
      const forms: [string, unknown][] = [
        ["2026-11-19T01:00", loop],
        ["2026-11-19T02:00", { [loop]: true }],
        ["2026-11-19T03:00", [[loop]]],
        ["2026-11-19T04:00", [loop.toUpperCase()]],
        ["2026-11-19T05:00", [` ${loop}`]],
        ["2026-11-19T06:00", `[${JSON.stringify(loop)}]`],
      ];
      for (const [key, loopIds] of forms) {
        await insertDigestCopy(trx, org, key, { text: `KEEP-${key}`, buttons: [], loopIds }, "pending", null);
      }
      await insertDigestCopy(
        trx,
        org,
        "2026-11-19T07:00",
        { text: "GONE", buttons: [], loopIds: [loop] },
        "pending",
        null
      );

      await switchOff(trx, org, org.mailboxId);

      const rows = await digestRows(trx, org.ctx.orgId);
      expect(rows).toHaveLength(7);
      expect(rows.filter((row) => row.text === "[removed]").map((row) => row.dedup_key)).toEqual([
        "digest:2026-11-19T07:00",
      ]);
      for (const row of rows.filter((row) => row.text !== "[removed]")) {
        expect(textOf(row)).toStartWith("KEEP-");
        expect(row.status).toBe("pending");
      }
    });
  });

  test("a scan of every table: no value of a closed-by-switch loop is left after the switch; before it, only loops and outbox hold them", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      const m = marks();
      await loopOf(trx, org, org.mailboxId, m);
      await runDigests(trx, EIGHT);
      expect(await tablesHolding(trx, values(m))).toEqual(["open_loops", "outbox"]);
      await switchOff(trx, org, org.mailboxId);
      expect(await tablesHolding(trx, values(m))).toEqual([]);
    });
  });

  test("the brief reads the loops that were closed before the switch the same: a closed loop is not in the digest at all", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      const m = marks();
      await insertLoopRow(trx, org.ctx, org.mailboxId, {
        status: "closed",
        close_reason: "done",
        closed_at: new Date("2026-11-19T10:00:00Z"),
        counterpart: m.counterpart,
        subject: m.subject,
        text: m.ask,
      });
      await runDigests(trx, EIGHT);
      expect(await tablesHolding(trx, values(m))).toEqual(["open_loops"]);
    });
  });
});

describe("retention clears the digest copy", () => {
  test("a digest older than the retention loses its text like any other row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      const m = marks();
      await loopOf(trx, org, org.mailboxId, m);
      await runDigests(trx, EIGHT);
      await trx
        .updateTable("outbox")
        .set({ status: "sent", sent_at: FRIDAY })
        .where("org_id", "=", org.ctx.orgId)
        .execute();
      await clearOutboxTexts(trx, org.ctx, { before: new Date("2026-12-01T00:00:00Z") });
      expect(await tablesHolding(trx, [m.counterpart, m.ask])).toEqual(["open_loops"]);
    });
  });
});

describe("the erase of a person (committed rows)", () => {
  const orgs: string[] = [];
  const users: string[] = [];
  afterEach(async () => {
    if (orgs.length > 0) await db.deleteFrom("organizations").where("id", "in", orgs).execute();
    if (users.length > 0) await db.deleteFrom("users").where("id", "in", users).execute();
    orgs.length = 0;
    users.length = 0;
  });

  async function world() {
    return db.transaction().execute(async (trx) => {
      await isolateChannels(trx);
      const org = await briefOrg(trx);
      orgs.push(org.ctx.orgId);
      users.push(org.userId, org.memberId);
      return org;
    });
  }

  test("a loop that names the person is cleared and every digest that named it is blanked or deleted; a digest of another person's loop stays", async () => {
    const org = await world();
    const person = marks();
    const stranger = marks();
    const ids = await db.transaction().execute(async (trx) => ({
      person: await loopOf(trx, org, org.mailboxId, person, "2026-11-19T09:00:00Z"),
      stranger: await loopOf(trx, org, org.mailboxId, stranger, "2026-11-18T09:00:00Z"),
    }));
    await runDigests(db, EIGHT);
    // The first digest was delivered; the second (next Monday) is still pending; the third names the stranger's loop only.
    await db
      .updateTable("outbox")
      .set({ status: "sent", sent_at: FRIDAY })
      .where("org_id", "=", org.ctx.orgId)
      .execute();
    await runDigests(db, "2026-11-23T07:00:00Z");
    const only = await db
      .transaction()
      .execute((trx) =>
        insertDigestCopy(
          trx,
          org,
          "2026-11-19T10:00",
          { text: `lines ${stranger.counterpart}`, buttons: [], loopIds: [ids.stranger] },
          "pending",
          null
        )
      );
    const before = await db
      .selectFrom("outbox")
      .select(["id", "status", "text", "view"])
      .where("org_id", "=", org.ctx.orgId)
      .execute();
    expect(before).toHaveLength(3);
    expect(before.filter((row) => JSON.stringify(row).includes(person.counterpart))).toHaveLength(2);

    const result = await eraseSubjectData(db, {
      orgId: org.ctx.orgId,
      address: person.counterpart,
      confirm: person.counterpart,
      credentialsKey: Buffer.alloc(32, 7).toString("base64"),
      now: FRIDAY,
    });
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.scrubbed["outbox.text"]).toBe(2);

    const after = await db
      .selectFrom("outbox")
      .select(["id", "status", "text", "view"])
      .where("org_id", "=", org.ctx.orgId)
      .execute();
    // Two rows named the person's loop: the delivered one is blank, the pending one is deleted. The third stays whole.
    expect(after.map((row) => row.id).sort()).toEqual(
      before
        .filter((row) => row.status === "sent" || row.id === only)
        .map((row) => row.id)
        .sort()
    );
    expect(after.find((row) => row.id === only)).toMatchObject({ status: "pending" });
    expect(textOf(after.find((row) => row.id === only) ?? { text: null, view: {} })).toBe(
      `lines ${stranger.counterpart}`
    );
    const blank = after.find((row) => row.status === "sent");
    expect([blank?.text, JSON.stringify(blank?.view)]).toEqual(["[removed]", "{}"]);
    expect(
      await tablesHolding(db as unknown as Transaction<DB>, [person.counterpart, person.ask, person.subject])
    ).toEqual([]);
  });

  test("a digest that never named the person's loop keeps its text", async () => {
    const org = await world();
    const person = marks();
    const stranger = marks();
    const personLoop = await db.transaction().execute(async (trx) => {
      await loopOf(trx, org, org.mailboxId, stranger);
      return loopOf(trx, org, org.mailboxId, person, "2026-11-21T09:00:00Z");
    });
    await runDigests(db, EIGHT);
    // Views that only look like they name the loop: a scalar, an object key, a nested list, an upper-case id (a probe of the SQL).
    await db.transaction().execute(async (trx) => {
      const forms: unknown[] = [personLoop, { [personLoop]: true }, [[personLoop]], [personLoop.toUpperCase()]];
      for (const [i, loopIds] of forms.entries()) {
        await insertDigestCopy(
          trx,
          org,
          `2026-11-19T0${i + 1}:00`,
          { text: `KEEP-${i}`, buttons: [], loopIds },
          "pending",
          null
        );
      }
    });
    const [row] = await db
      .selectFrom("outbox")
      .select(["text", "view"])
      .where("org_id", "=", org.ctx.orgId)
      .where("dedup_key", "like", "digest:2026-11-20%")
      .execute();
    // The person's loop is due on Saturday: not in this brief.
    expect(JSON.stringify(row)).toContain(stranger.counterpart);
    expect(JSON.stringify(row)).not.toContain(person.counterpart);

    const result = await eraseSubjectData(db, {
      orgId: org.ctx.orgId,
      address: person.counterpart,
      confirm: person.counterpart,
      credentialsKey: Buffer.alloc(32, 7).toString("base64"),
      now: FRIDAY,
    });
    expect(result.kind).toBe("erased");
    const after = await db
      .selectFrom("outbox")
      .select(["text", "view", "dedup_key"])
      .where("org_id", "=", org.ctx.orgId)
      .orderBy("dedup_key")
      .execute();
    expect(after).toHaveLength(5);
    expect(JSON.stringify(after.find((row) => row.dedup_key.startsWith("digest:2026-11-20")))).toContain(
      stranger.counterpart
    );
    expect(after.filter((row) => textOf(row).startsWith("KEEP-"))).toHaveLength(4);
  });
});
