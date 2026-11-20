import { randomUUID } from "node:crypto";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { backfillInbox, syncMailbox, type SeedMessage, type SyncDeps } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertEmail, lockSyncFolder } from "../../src/modules/mail/repo";
import { eraseSubjectData } from "../../src/modules/privacy";
import { tombstoneKeyHash } from "../../src/platform/crypto";

import { createOrgWithMailbox, insertAction } from "./fixtures";
import { testDb } from "./helpers";
import { KEY, unique, makeDsrKit } from "./privacy-dsr-erase-helpers";

// `eraseSubjectData`: the sync folder lock and the tombstones. The seed is committed (the erase runs its own transaction and takes row locks);
// `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const { seedOrg, count, erase, erased, eraseAudit, waitBlocked, orgIds, userIds, cleanup } = makeDsrKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

describe("the sync folder lock and the tombstones", () => {
  test("a sync chunk that holds the folder lock makes the erase wait, and its mail from the person goes too", async () => {
    const w = await seedOrg(unique());
    const ctx = { orgId: w.orgId };
    const folder = await db
      .selectFrom("mailbox_folders")
      .select("id")
      .where("mailbox_id", "=", w.boxId)
      .executeTakeFirstOrThrow();
    let locked!: () => void;
    const lockedP = new Promise<void>((resolveLock) => (locked = resolveLock));
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    const lateKey = `mid:<late-${randomUUID().slice(0, 8)}@x.test>:h1`;
    // The chunk of a sync: it takes the folder lock and inserts a mail from the person that the erase cannot see yet.
    const chunk = db.transaction().execute(async (trx) => {
      await lockSyncFolder(trx, ctx, folder.id);
      await insertEmail(trx, ctx, {
        mailbox_id: w.boxId,
        dedup_key: lateKey,
        thread_key: `t:${lateKey}`,
        content_hash: "h",
        uid: 99,
        received_at: new Date(),
        source_folder: "INBOX",
        from_address: w.person,
        to_addresses: [w.own],
      });
      locked();
      await gate;
    });
    await lockedP;
    let finished = false;
    const erasing = erase(w).then((result) => {
      finished = true;
      return result;
    });
    try {
      // The erase waits on the folder lock (a backend that waits on a lock while its text names the folder table).
      await waitBlocked("mailbox_folders", () => finished);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await chunk;
    const result = await erasing;
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.counts.mails).toBe(3);
    const left = await db
      .selectFrom("emails")
      .select("dedup_key")
      .where("org_id", "=", w.orgId)
      .where("from_address", "=", w.person)
      .execute();
    expect(left).toEqual([]);
    const tombs = await db.selectFrom("dsr_tombstones").select("key_hash").where("org_id", "=", w.orgId).execute();
    expect(tombs.map((row) => row.key_hash)).toContain(tombstoneKeyHash(lateKey));
  });

  test("an open send that commits after the match, before the mail lock: refused, nothing deleted", async () => {
    const w = await seedOrg(unique());
    const ctx = { orgId: w.orgId };
    let inserted!: () => void;
    const insertedP = new Promise<void>((resolveInsert) => (inserted = resolveInsert));
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    let sendId = "";
    // A writer (a triage job) adds an open send to a mail that goes and keeps it uncommitted: the match cannot see it.
    const writer = db.transaction().execute(async (trx) => {
      sendId = await insertAction(trx, ctx, w.goes[0] as string, { type: "send", status: "awaiting_approval" });
      inserted();
      await gate;
    });
    await insertedP;
    const before = await count("emails", w.orgId);
    let finished = false;
    const erasing = erase(w).then((result) => {
      finished = true;
      return result;
    });
    try {
      // The erase waits for the row lock of the mail (the writer holds a key share on it through its foreign key).
      await waitBlocked("from emails", () => finished);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await writer;
    expect(await erasing).toEqual({ kind: "open_actions", actionIds: [sendId] });
    expect(await count("emails", w.orgId)).toBe(before);
    expect(await db.selectFrom("actions").select("id").where("id", "=", sendId).execute()).toHaveLength(1);
    expect(await count("dsr_tombstones", w.orgId)).toBe(0);
    expect(await eraseAudit(w.orgId)).toHaveLength(0);
  });

  test("4. rescan and backfill store none of the erased mails, not as `#2` either; a new mail from the person is stored", async () => {
    const person = unique();
    const NOW = new Date("2026-11-03T12:00:00Z");
    const day = DAY_MS;
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const { orgId, userId, mailboxId } = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    orgIds.push(orgId);
    userIds.push(userId);
    const ctx = { orgId };
    const mailbox = await db
      .selectFrom("mailboxes")
      .select("address")
      .where("id", "=", mailboxId)
      .executeTakeFirstOrThrow();
    const fake = createFakeMailProvider({ uidValidity: 7 });
    const seed = (n: number, from: string): SeedMessage => ({
      messageId: `<e${n}-${person}>`,
      from,
      to: [mailbox.address],
      subject: `Mail ${n}`,
      date: NOW,
      text: `Body ${n}`,
    });
    fake.deliver("INBOX", seed(1, person), { internalDate: ago(20 * day) });
    fake.deliver("INBOX", seed(2, person), { internalDate: ago(10 * day) });
    fake.deliver("INBOX", seed(3, `other-${person}`), { internalDate: ago(5 * day) });
    fake.deliver("INBOX", seed(4, person), { internalDate: ago(2 * HOUR_MS) });
    const deps: SyncDeps = { db, provider: fake, isOwnActionId: async () => false, now: () => NOW };
    expect((await syncMailbox(deps, ctx, mailboxId)).stored).toBe(1);
    expect((await backfillInbox(deps, ctx, mailboxId, { since: ago(30 * day) })).stored).toBe(3);
    const ids = async () =>
      (await db.selectFrom("emails").select("message_id_header").where("mailbox_id", "=", mailboxId).execute())
        .map((row) => row.message_id_header)
        .sort();
    expect(await ids()).toHaveLength(4);

    const result = await eraseSubjectData(db, { orgId, address: person, confirm: person, credentialsKey: KEY });
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.counts.mails).toBe(3);
    expect(await ids()).toEqual([`<e3-${person}>`]);

    // The mailbox still holds the erased mails. A rescan (UIDVALIDITY changed) and a backfill must not bring them back.
    fake.resetUidValidity(8);
    fake.deliver("INBOX", seed(5, person), { internalDate: ago(HOUR_MS) });
    const rescan = await syncMailbox(deps, ctx, mailboxId);
    expect(rescan.mode).toBe("rescan");
    expect(rescan.stored).toBe(1);
    expect((await backfillInbox(deps, ctx, mailboxId, { since: ago(30 * day) })).stored).toBe(0);
    expect(await ids()).toEqual([`<e3-${person}>`, `<e5-${person}>`]);
  });

  test("4b. a copy `#2` of an erased mail is skipped by the trigger; a mail with another key is stored", async () => {
    const w = await seedOrg(unique());
    await erased(w);
    const ctx = { orgId: w.orgId };
    const row = (key: string) => ({
      mailbox_id: w.boxId,
      dedup_key: key,
      thread_key: `t:${key}`,
      content_hash: "h",
      uid: 5,
      received_at: new Date(),
      source_folder: "INBOX",
      from_address: w.person,
    });
    const keys = w.goesKeys;
    expect(await insertEmail(db, ctx, row(keys[0] as string))).toBe(false);
    expect(await insertEmail(db, ctx, row(`${keys[0]}#2`))).toBe(false);
    expect(await insertEmail(db, ctx, row(`${keys[1]}#7`))).toBe(false);
    expect(await insertEmail(db, ctx, row(`mid:<new-${randomUUID().slice(0, 8)}@x.test>:h1`))).toBe(true);
  });
});
