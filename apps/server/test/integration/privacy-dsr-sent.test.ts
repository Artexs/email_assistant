import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { sentOriginOf } from "../../src/modules/actions";
import { auditEvents } from "../../src/modules/audit";
import { clearSentBodies, insertSentEmails, lockSentSyncState, type NewSentEmail } from "../../src/modules/mail/repo";
import { setSentSync } from "../../src/modules/mail/sent-switch";
import { syncSentHeaders, type SentSyncDeps } from "../../src/modules/mail/sent-sync";
import {
  dsrCounts,
  dsrIsEmpty,
  eraseSubjectData,
  exportOrganization,
  findSubjectData,
  matchSubject,
  type DsrEraseResult,
} from "../../src/modules/privacy";
import { configureFeatures } from "../../src/modules/tenancy";
import { tombstoneKeyHash } from "../../src/platform/crypto";
import { waitFor } from "../wait-for";

import { testDb, TEST_CREDENTIALS_KEY } from "./helpers";
import { ago, NOW, put, siblingMailbox, newOrg, type Org } from "./mail-sent-fixtures";

// A data request finds, reports and erases sent mail. The seed is committed (the erase runs its own
// transaction and takes row locks); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");
const KEY = Buffer.alloc(32, 7).toString("base64");
const dir = mkdtempSync(join(tmpdir(), "f104-dsr-sent-"));

const orgIds: string[] = [];
const userIds: string[] = [];
let identity: string;
let recipient: string;

beforeAll(async () => {
  identity = await generateX25519Identity();
  recipient = await identityToRecipient(identity);
});

beforeEach(() => {
  configureFeatures({ off: [] });
});

afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.destroy();
});

interface World {
  org: Org;
  orgId: string;
  boss: string;
  team: string;
  person: string;
  other: string; // a third party, not an own address
}

// An organization with two own mailboxes (`boss`, `team`) and the Sent switch on. The first mailbox has a fake provider.
async function seedWorld(): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const world = await db.transaction().execute(async (trx): Promise<World> => {
    const org = await newOrg(trx);
    const second = await siblingMailbox(trx, org);
    const boxes = await trx
      .selectFrom("mailboxes")
      .select(["id", "address"])
      .where("org_id", "=", org.ctx.orgId)
      .execute();
    const addressOf = (id: string) => boxes.find((box) => box.id === id)?.address as string;
    return {
      org,
      orgId: org.ctx.orgId,
      boss: addressOf(org.mailboxId),
      team: addressOf(second.mailboxId),
      person: `p-${suffix}@x.test`,
      other: `q-${suffix}@x.test`,
    };
  });
  orgIds.push(world.orgId);
  userIds.push(world.org.userId);
  return world;
}

let counter = 0;

interface SentSpec {
  from: string | null;
  to: string[];
  cc?: string[];
  subject?: string;
  // `pending` (default) or `headers_only` come from the insert; `stored` and `cleared` are set after it.
  content?: "pending" | "headers_only" | "stored" | "cleared";
  body?: string;
}

async function addSent(w: World, spec: SentSpec): Promise<{ id: string; dedupKey: string }> {
  counter += 1;
  const dedupKey = `mid:<s${counter}-${randomUUID().slice(0, 8)}@x.test>:h1`;
  const old = spec.content === "cleared";
  const at = old ? ago(40 * DAY_MS) : ago(DAY_MS);
  const row: NewSentEmail = {
    mailboxId: w.org.mailboxId,
    dedupKey,
    path: "Sent",
    uidValidity: 7,
    uid: counter,
    messageId: `<s${counter}@x.test>`,
    parentMessageId: null,
    referencesIds: [],
    threadKey: `t:${dedupKey}`,
    fromAddress: spec.from,
    toAddresses: spec.to,
    ccAddresses: spec.cc ?? [],
    subject: spec.subject ?? `subject ${counter}`,
    sentAt: at,
    internalDate: at,
    origin: "user",
    actionId: null,
    content: spec.content === "headers_only" ? "headers_only" : "pending",
  };
  await db.transaction().execute((trx) => insertSentEmails(trx, w.org.ctx, [row]));
  const stored = await db
    .selectFrom("sent_emails")
    .select("id")
    .where("org_id", "=", w.orgId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirstOrThrow();
  if (spec.content === "stored" || old) {
    await db
      .updateTable("sent_emails")
      .set({ content: "stored", body_text: spec.body ?? `body ${counter}` })
      .where("id", "=", stored.id)
      .execute();
  }
  if (old) await clearSentBodies(db, w.org.ctx, { before: ago(14 * DAY_MS) });
  return { id: stored.id, dedupKey };
}

function sentRows(orgId: string) {
  return db.selectFrom("sent_emails").selectAll().where("org_id", "=", orgId).orderBy("id").execute();
}

async function sentRow(id: string) {
  return db.selectFrom("sent_emails").selectAll().where("id", "=", id).executeTakeFirst();
}

async function snapshot(orgId: string): Promise<string> {
  return JSON.stringify(await sentRows(orgId));
}

function tombstones(orgId: string) {
  return db.selectFrom("dsr_tombstones").select("key_hash").where("org_id", "=", orgId).execute();
}

function erase(w: World, extra: { address?: string } = {}): Promise<DsrEraseResult> {
  const address = extra.address ?? w.person;
  return eraseSubjectData(db, { orgId: w.orgId, address, confirm: address, credentialsKey: KEY, now: NOW });
}

async function erased(w: World) {
  const result = await erase(w);
  if (result.kind !== "erased") throw new Error(`erase answered ${result.kind}`);
  return result;
}

function match(orgId: string, address: string) {
  return db.transaction().execute((trx) => matchSubject(trx, orgId, address, TEST_CREDENTIALS_KEY));
}

async function auditData(orgId: string, event: string) {
  const rows = await db
    .selectFrom("audit_log")
    .select("data")
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .execute();
  return rows.map((row) => row.data as Record<string, unknown>);
}

async function run(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

async function decrypt(path: string): Promise<Record<string, unknown>> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  return JSON.parse(await decrypter.decrypt(new Uint8Array(await readFile(path)), "text"));
}

// Polls until a backend waits on a lock while its query text holds `fragment`, or `done()` is true.
async function waitBlocked(fragment: string, done: () => boolean): Promise<void> {
  let waiting = false;
  await waitFor(() => {
    void db
      .selectFrom(sql<{ n: string }>`pg_stat_activity`.as("a"))
      .select(sql<boolean>`true`.as("x"))
      .where(sql<boolean>`a.wait_event_type = 'Lock' and a.query like ${`%${fragment}%`} and a.pid <> pg_backend_pid()`)
      .execute()
      .then((rows) => {
        waiting = rows.length > 0;
      });
    return waiting || done();
  }, `the erase waits on a lock (${fragment}) or finishes`);
}

function sentDeps(org: Org): SentSyncDeps {
  return {
    db,
    provider: org.provider,
    sentOriginOf: (ctx, mailboxId, actionId) => sentOriginOf(db, ctx, mailboxId, actionId),
    now: () => NOW,
  };
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe("data request for sent mail", () => {
  test("1. find: a mail to the person and own mailboxes goes; one with a third party is a mention", async () => {
    const w = await seedWorld();
    const s1 = await addSent(w, { from: w.boss, to: [w.person] });
    const s2 = await addSent(w, { from: w.boss, to: [w.person, w.other] });
    const s3 = await addSent(w, { from: w.boss, to: [w.team], cc: [w.person.toUpperCase()] });
    const found = await match(w.orgId, w.person);
    expect(ids(found.sentMails)).toEqual(ids([s1, s3]));
    expect(found.sentMails.map((row) => row.dedupKey).sort()).toEqual([s1.dedupKey, s3.dedupKey].sort());
    expect(found.mentions["sent_emails.to_addresses"]).toEqual([s2.id]);
    expect(Object.values(found.mentions).flat()).not.toContain(s1.id);
    expect(Object.values(found.mentions).flat()).not.toContain(s3.id);
    expect(dsrCounts(found).sent_mails).toBe(2);
  });

  test("1b. the person as sender: a mail to an own mailbox goes; a mail to a third party is a mention", async () => {
    const w = await seedWorld();
    const goes = await addSent(w, { from: w.person, to: [w.boss] });
    const kept = await addSent(w, { from: w.person, to: [w.other] });
    const found = await match(w.orgId, w.person);
    expect(ids(found.sentMails)).toEqual([goes.id]);
    expect(found.mentions["sent_emails.from_address"]).toEqual([kept.id]);
    await erased(w);
    expect(await sentRow(goes.id)).toBeUndefined();
    expect((await sentRow(kept.id))?.from_address).toBeNull();
  });

  test("2. erase: the mails that go are deleted with tombstones; the others lose the address and pending text", async () => {
    const w = await seedWorld();
    const s1 = await addSent(w, { from: w.boss, to: [w.person] });
    const s2 = await addSent(w, { from: w.boss, to: [w.person, w.other], subject: `about ${w.person}` });
    const s3 = await addSent(w, { from: w.boss, to: [w.team], cc: [w.person] });
    const stored = await addSent(w, {
      from: w.boss,
      to: [w.other],
      cc: [w.person],
      content: "stored",
      body: `please write to ${w.person} soon`,
    });
    const cleared = await addSent(w, { from: w.boss, to: [w.other], cc: [w.person], content: "cleared" });
    expect((await sentRow(s2.id))?.content).toBe("pending");
    expect(await sentRow(cleared.id)).toMatchObject({ content: "stored", body_text: null });

    const result = await erased(w);
    expect(result.counts.sent_mails).toBe(2);
    expect(result.tombstones).toBe(2);
    expect(await sentRow(s1.id)).toBeUndefined();
    expect(await sentRow(s3.id)).toBeUndefined();
    const hashes = (await tombstones(w.orgId)).map((row) => row.key_hash);
    expect(hashes).toContain(tombstoneKeyHash(s1.dedupKey));
    expect(hashes).toContain(tombstoneKeyHash(s3.dedupKey));

    const kept = await sentRow(s2.id);
    expect(kept?.to_addresses).toEqual([w.other]);
    expect(kept?.subject).not.toContain(w.person);
    expect(kept?.content).toBe("headers_only");
    // A kept `stored` row stays stored; its text loses the address.
    const keptStored = await sentRow(stored.id);
    expect(keptStored?.content).toBe("stored");
    expect(keptStored?.body_text).toContain("[removed]");
    expect(keptStored?.body_text).not.toContain(w.person);
    expect(keptStored?.cc_addresses).toEqual([]);
    // A row that retention cleared has no text: the erase handles the null and still scrubs the addresses.
    const keptCleared = await sentRow(cleared.id);
    expect(keptCleared).toMatchObject({ content: "stored", body_text: null, cc_addresses: [] });
    expect(keptCleared?.to_addresses).toEqual([w.other]);
    expect((await match(w.orgId, w.person)).mentions).toEqual({});
  });

  test("3. a later pass does not store the erased mail again; a newer mail is stored (erase again)", async () => {
    const w = await seedWorld();
    put(w.org, 1, ago(2 * DAY_MS), { from: w.boss, to: [w.person] });
    const first = await syncSentHeaders(sentDeps(w.org), w.org.ctx, w.org.mailboxId);
    expect(first).toMatchObject({ status: "done", stored: 1 });
    const found = await match(w.orgId, w.person);
    expect(found.sentMails).toHaveLength(1);
    const key = found.sentMails[0]?.dedupKey as string;

    const result = await erased(w);
    expect(result.counts.sent_mails).toBe(1);
    expect(await sentRows(w.orgId)).toEqual([]);
    expect((await tombstones(w.orgId)).map((row) => row.key_hash)).toContain(tombstoneKeyHash(key));

    // Off and on starts a new first pass over the Sent folder, which still holds the mail.
    const off = await setSentSync(db, w.org.ctx, w.org.mailboxId, { enabled: false, actor: "test", at: ago(HOUR_MS) });
    expect(off.result).toBe("changed");
    const on = await setSentSync(db, w.org.ctx, w.org.mailboxId, { enabled: true, actor: "test", at: ago(HOUR_MS) });
    expect(on.result).toBe("changed");
    put(w.org, 2, ago(HOUR_MS), { from: w.boss, to: [w.person] });
    const second = await syncSentHeaders(sentDeps(w.org), w.org.ctx, w.org.mailboxId);
    expect(second).toMatchObject({ status: "done", fetched: 2, stored: 1 });
    const rows = await sentRows(w.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message_id).toBe("<sent2@x.test>");

    // The limit of the erase: mail that arrives later names the person again, so the operator erases again.
    const again = await erased(w);
    expect(again.counts.sent_mails).toBe(1);
    expect(await sentRows(w.orgId)).toEqual([]);
  });

  test("4. the find audit row holds the count and no address; the report holds the mails that go; the CLI prints counts only", async () => {
    const w = await seedWorld();
    const s1 = await addSent(w, {
      from: w.boss,
      to: [w.person],
      subject: "first",
      content: "stored",
      body: "text one",
    });
    const s3 = await addSent(w, { from: w.boss, to: [w.team], cc: [w.person], subject: "third" });
    await addSent(w, { from: w.boss, to: [w.person, w.other] });

    const out = join(dir, `${randomUUID()}.age`);
    const found = await findSubjectData(db, {
      orgId: w.orgId,
      address: w.person,
      credentialsKey: KEY,
      report: { recipient, out },
      now: NOW,
    });
    expect(found.kind).toBe("found");
    const report = await decrypt(out);
    const sent = report.sent_mails as Record<string, unknown>[];
    expect(sent.map((row) => row.id).sort()).toEqual([s1.id, s3.id].sort());
    const first = sent.find((row) => row.id === s1.id);
    expect(first).toMatchObject({
      mailbox_id: w.org.mailboxId,
      from_address: w.boss,
      to_addresses: [w.person],
      cc_addresses: [],
      subject: "first",
      body_text: "text one",
    });
    expect(Object.keys(first as object).sort()).toEqual(
      ["id", "mailbox_id", "sent_at", "from_address", "to_addresses", "cc_addresses", "subject", "body_text"].sort()
    );
    expect((report.mentions as Record<string, string[]>)["sent_emails.to_addresses"]).toHaveLength(1);

    const cli = await run(["--org-id", w.orgId, "--address", w.person, "--find"]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toContain("sent mails 2\n");
    expect(cli.stdout + cli.stderr).not.toContain(w.person);

    const findAudit = await auditData(w.orgId, auditEvents.dsrFind);
    expect(findAudit.at(0)).toMatchObject({ sent_mails: 2 });
    for (const data of findAudit) expect(JSON.stringify(data)).not.toContain(w.person);
  });

  // The erase runs in its own case, so a case starts one `bun` process. Each start scans every code point for the rule
  // check (about 0.7 s); two starts in a row used half of the 5 s test limit and failed in a loaded CI run.
  test("4c. the erase audit row holds the count and no address; the CLI prints counts only", async () => {
    const w = await seedWorld();
    await addSent(w, { from: w.boss, to: [w.person], subject: "first", content: "stored", body: "text one" });
    await addSent(w, { from: w.boss, to: [w.team], cc: [w.person], subject: "third" });
    await addSent(w, { from: w.boss, to: [w.person, w.other] });

    const cliErase = await run(["--org-id", w.orgId, "--address", w.person, "--erase", "--confirm", w.person]);
    expect(cliErase.code).toBe(0);
    expect(cliErase.stdout).toContain("erased sent mails 2\n");
    expect(cliErase.stdout + cliErase.stderr).not.toContain(w.person);

    const eraseAudit = await auditData(w.orgId, auditEvents.dsrErase);
    expect(eraseAudit).toHaveLength(1);
    expect(eraseAudit[0]).toMatchObject({ sent_mails: 2 });
    expect(JSON.stringify(eraseAudit[0])).not.toContain(w.person);
  });

  test("4b. a person who is only in sent mail is a match: no empty count, no spelling warning", async () => {
    const w = await seedWorld();
    await addSent(w, { from: w.boss, to: [w.person] });
    const found = await match(w.orgId, w.person);
    expect(found.mails).toEqual([]);
    expect(dsrIsEmpty(dsrCounts(found))).toBe(false);
    // The two starts do not depend on each other, so they run together (two in a row used half of the 5 s limit).
    const [cli, nobody] = await Promise.all([
      run(["--org-id", w.orgId, "--address", w.person, "--find"]),
      run(["--org-id", w.orgId, "--address", `nobody-${randomUUID().slice(0, 8)}@x.test`, "--find"]),
    ]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toContain("sent mails 1\n");
    expect(cli.stderr).not.toContain("warning");
    expect(nobody.stderr).toContain("warning: no match");
  });

  test("5. a Sent pass that holds the state row makes the erase wait; its late mail to the person goes too", async () => {
    const w = await seedWorld();
    await addSent(w, { from: w.boss, to: [w.person] });
    let locked!: () => void;
    const lockedP = new Promise<void>((resolveLock) => (locked = resolveLock));
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => (release = resolveGate));
    // The chunk of a Sent pass: it takes the state row lock and inserts a mail that the erase cannot see yet.
    const late = addLate(w);
    const chunk = db.transaction().execute(async (trx) => {
      await lockSentSyncState(trx, w.org.ctx, w.org.mailboxId);
      await insertSentEmails(trx, w.org.ctx, [late]);
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
      await waitBlocked("mailbox_sent_sync", () => finished);
      expect(finished).toBe(false);
    } finally {
      release();
    }
    await chunk;
    const result = await erasing;
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.counts.sent_mails).toBe(2);
    expect(await sentRows(w.orgId)).toEqual([]);
    expect((await tombstones(w.orgId)).map((row) => row.key_hash)).toContain(tombstoneKeyHash(late.dedupKey));
    expect((await match(w.orgId, w.person)).sentMails).toEqual([]);
  });

  test("6. the sent rows of another organization with the same person stay whole", async () => {
    const a = await seedWorld();
    const b = await seedWorld();
    // The same person in both organizations.
    const person = a.person;
    const bGoes = await addSent({ ...b, person }, { from: b.boss, to: [person] });
    await addSent({ ...b, person }, { from: b.boss, to: [person, b.other], subject: `about ${person}` });
    // A row of B that has only addresses that A owns, so the rule alone would send it with A's mails.
    await addSent(b, { from: a.boss, to: [person] });
    const aGoes = await addSent(a, { from: a.boss, to: [person] });
    // The match of organization A reads only its own rows (the find has no tenant scope here, so only the filter holds).
    const foundA = await match(a.orgId, person);
    expect(ids(foundA.sentMails)).toEqual([aGoes.id]);
    expect(Object.values(foundA.mentions).flat()).toEqual([]);
    const before = await snapshot(b.orgId);
    const foundB = await match(b.orgId, person);
    const result = await erased(a);
    expect(result.counts.sent_mails).toBe(1);
    expect(await snapshot(b.orgId)).toBe(before);
    expect(await tombstones(b.orgId)).toEqual([]);
    expect(ids((await match(b.orgId, person)).sentMails)).toEqual(ids(foundB.sentMails));
    expect(await sentRow(bGoes.id)).toBeDefined();
  });

  test("7. an own address is refused: no sent row changes", async () => {
    const w = await seedWorld();
    await addSent(w, { from: w.boss, to: [w.team, w.other] });
    await addSent(w, { from: w.boss, to: [w.team] });
    const before = await snapshot(w.orgId);
    for (const address of [w.boss, w.team.toUpperCase()]) {
      expect((await erase(w, { address })).kind).toBe("own_address");
    }
    expect(await snapshot(w.orgId)).toBe(before);
    expect(await tombstones(w.orgId)).toEqual([]);
  });

  test("a failure in the erase rolls back the sent part: rows, pending content, tombstones and the audit row", async () => {
    const w = await seedWorld();
    await addSent(w, { from: w.boss, to: [w.person] });
    await addSent(w, { from: w.boss, to: [w.person, w.other] });
    const before = await snapshot(w.orgId);
    await expect(
      eraseSubjectData(db, {
        orgId: w.orgId,
        address: w.person,
        confirm: w.person,
        credentialsKey: KEY,
        now: NOW,
        step: async () => {
          throw new Error("boom");
        },
      })
    ).rejects.toThrow("boom");
    expect(await snapshot(w.orgId)).toBe(before);
    expect(await tombstones(w.orgId)).toEqual([]);
    expect(await auditData(w.orgId, auditEvents.dsrErase)).toEqual([]);
  });

  test("the person as sender in another letter case is found and erased", async () => {
    const w = await seedWorld();
    const goes = await addSent(w, { from: w.person.toUpperCase(), to: [w.boss] });
    expect(ids((await match(w.orgId, w.person)).sentMails)).toEqual([goes.id]);
    const result = await erased(w);
    expect(result.counts.sent_mails).toBe(1);
    expect(await sentRow(goes.id)).toBeUndefined();
  });

  test("the export of a row that retention cleared shows body_text null", async () => {
    const w = await seedWorld();
    const cleared = await addSent(w, { from: w.boss, to: [w.other], cc: [w.person], content: "cleared" });
    const out = join(dir, `${randomUUID()}.age`);
    const exported = await exportOrganization(db, {
      orgId: w.orgId,
      recipient,
      out,
      credentialsKey: TEST_CREDENTIALS_KEY,
      now: NOW,
    });
    expect(exported.kind).toBe("written");
    const file = await decrypt(out);
    const rows = (file.tables as Record<string, Record<string, unknown>[]>).sent_emails ?? [];
    const row = rows.find((candidate) => candidate.id === cleared.id);
    expect(row).toMatchObject({ content: "stored", body_text: null });
  });
});

// A mail from the person to an own mailbox, written by a Sent pass chunk that is not committed yet.
function addLate(w: World): NewSentEmail {
  counter += 1;
  const dedupKey = `mid:<late${counter}-${randomUUID().slice(0, 8)}@x.test>:h1`;
  return {
    mailboxId: w.org.mailboxId,
    dedupKey,
    path: "Sent",
    uidValidity: 7,
    uid: 1000 + counter,
    messageId: `<late${counter}@x.test>`,
    parentMessageId: null,
    referencesIds: [],
    threadKey: `t:${dedupKey}`,
    fromAddress: w.boss,
    toAddresses: [w.person],
    ccAddresses: [],
    subject: "late",
    sentAt: ago(HOUR_MS),
    internalDate: ago(HOUR_MS),
    origin: "user",
    actionId: null,
    content: "pending",
  };
}
