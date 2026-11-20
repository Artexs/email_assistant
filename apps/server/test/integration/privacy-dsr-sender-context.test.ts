import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Decrypter, generateX25519Identity, identityToRecipient } from "age-encryption";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import {
  deleteSenderContextRowsOf,
  lockProfilesOfOrg,
  refreshMailboxProfiles,
  senderContextRowsOf,
} from "../../src/modules/contacts";
import { eraseSubjectData, findSubjectData } from "../../src/modules/privacy";
import { setOrgFeature } from "../../src/modules/tenancy";
import { dsrAddressHash, senderKeyHash } from "../../src/platform/crypto";
import { createDb } from "../../src/platform/db";
import { waitFor } from "../wait-for";

import { ago, KEY, newOrg, NO_TEST, NOW, secondMailbox, type Org } from "./contacts-fixtures";
import { seedSenderActivity } from "./fixtures";
import { testDb } from "./helpers";

// Sender context in a data request: the profile rows hold only the keyed hash of the address, so the find and the erase
// compute the hash and look for it in every mailbox of the organization. The seed is committed (the erase runs its own
// transaction); `afterEach` removes it. The connection is the `app` role.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/org-dsr.ts");

const orgIds: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});
const reportDir = mkdtempSync(join(tmpdir(), "f120-dsr-"));
let identity: string;
let recipient: string;
beforeAll(async () => {
  identity = await generateX25519Identity();
  recipient = await identityToRecipient(identity);
});
afterAll(async () => {
  rmSync(reportDir, { recursive: true, force: true });
  await db.destroy();
});

const ANNA = "anna@acme.pl";
const BOB = "bob@acme.pl";

interface World extends Org {
  second: Org;
}

// An organization with two mailboxes and the flag `sender_context`; committed. Anna wrote to both mailboxes, Bob to the first.
async function seedWorld(): Promise<World> {
  const world = await db.transaction().execute(async (trx) => {
    const org = await newOrg(trx);
    const second = await secondMailbox(trx, org);
    await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: ANNA, mails: [{ at: ago(3) }, { at: ago(2) }] });
    await seedSenderActivity(trx, org.ctx, second.mailboxId, { address: ANNA, mails: [{ at: ago(1) }] });
    await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: BOB, mails: [{ at: ago(1) }] });
    return { ...org, second };
  });
  orgIds.push(world.ctx.orgId);
  // The owner of the organization (`createOrgWithMailbox`) is removed with it; the user row goes in `afterEach` through the org.
  const owner = await db
    .selectFrom("memberships")
    .select("user_id")
    .where("org_id", "=", world.ctx.orgId)
    .executeTakeFirst();
  if (owner) userIds.push(owner.user_id);
  for (const box of [world.mailboxId, world.second.mailboxId]) await pass(world, box);
  return world;
}

const pass = (w: World, mailboxId: string) =>
  refreshMailboxProfiles({ db, credentialsKey: KEY, testMail: NO_TEST }, w.ctx, mailboxId, { now: NOW });

const hashOf = (orgId: string, value: string) => senderKeyHash(KEY, orgId, value);

const profileHashes = async (w: World): Promise<string[]> =>
  (await db.selectFrom("sender_profiles").select("key_hash").where("org_id", "=", w.ctx.orgId).execute())
    .map((row) => row.key_hash)
    .sort();

const suggest = (
  w: World,
  over: {
    mailboxId?: string;
    value: string;
    scope?: "address" | "domain";
    kind?: "vip" | "whitelist" | "blocklist";
  } & {
    open?: boolean;
  }
) =>
  db
    .insertInto("sender_suggestions")
    .values({
      org_id: w.ctx.orgId,
      mailbox_id: over.mailboxId ?? w.mailboxId,
      key_hash: hashOf(w.ctx.orgId, over.value),
      scope: over.scope ?? "address",
      kind: over.kind ?? "vip",
      ...(over.open === false
        ? { pattern: null, status: "dismissed" as const, ended_at: NOW }
        : { pattern: over.value }),
    })
    .returning("id")
    .executeTakeFirstOrThrow()
    .then((row) => row.id);

const suggestionIds = async (w: World): Promise<string[]> =>
  (await db.selectFrom("sender_suggestions").select("id").where("org_id", "=", w.ctx.orgId).execute())
    .map((row) => row.id)
    .sort();

const find = (w: World, address: string) =>
  findSubjectData(db, { orgId: w.ctx.orgId, address, credentialsKey: KEY, now: NOW });
const erase = (w: World, address: string) =>
  eraseSubjectData(db, { orgId: w.ctx.orgId, address, confirm: address, credentialsKey: KEY, now: NOW });

describe("sender profiles and suggestions in a data request", () => {
  test("1 the find counts the profile rows of the person in every mailbox; the erase deletes them and keeps another person's", async () => {
    const w = await seedWorld();
    const before = await profileHashes(w);
    expect(before).toHaveLength(3);

    const found = await find(w, ANNA.toUpperCase());
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.counts.sender_profiles).toBe(2);
    expect(found.counts.sender_suggestions).toBe(0);

    const result = await erase(w, ANNA);
    expect(result.kind).toBe("erased");
    if (result.kind !== "erased") return;
    expect(result.counts.sender_profiles).toBe(2);
    expect(await profileHashes(w)).toEqual([hashOf(w.ctx.orgId, BOB)]);
    // A second erase finds nothing more and ends in the same state.
    expect((await erase(w, ANNA)).kind).toBe("erased");
    expect(await profileHashes(w)).toEqual([hashOf(w.ctx.orgId, BOB)]);
  });

  test("2 an open suggestion with the address as pattern and an ended one with only the key go; another person's stay", async () => {
    const w = await seedWorld();
    const open = await suggest(w, { value: ANNA });
    const ended = await suggest(w, { value: ANNA, kind: "whitelist", open: false, mailboxId: w.second.mailboxId });
    // An open row whose key does not match (pattern only): the pattern rule of the address map finds it, the hash does not.
    const byPattern = await db
      .insertInto("sender_suggestions")
      .values({
        org_id: w.ctx.orgId,
        mailbox_id: w.mailboxId,
        key_hash: hashOf(w.ctx.orgId, "other-key"),
        scope: "address",
        kind: "blocklist",
        pattern: ANNA,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const bobOpen = await suggest(w, { value: BOB });
    const bobEnded = await suggest(w, { value: BOB, kind: "blocklist", open: false });

    const found = await find(w, ANNA);
    if (found.kind !== "found") throw new Error("find refused");
    // The open row is found twice (pattern and key) and counted once; the pattern-only row and the ended row once each.
    expect(found.counts.sender_suggestions).toBe(3);

    const result = await erase(w, ANNA);
    expect(result.kind).toBe("erased");
    expect(await suggestionIds(w)).toEqual([bobOpen, bobEnded].sort());
    expect([open, ended, byPattern.id]).not.toContain(bobOpen);
  });

  test("3 another organization's rows of the same address stay, even with the same key value in a row", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    // The keys of two organizations differ by design (the org id is in the HMAC message); a row of the other organization that
    // holds the key of this one is the worst case for a missing `org_id` filter.
    const forged = hashOf(w.ctx.orgId, ANNA);
    await db
      .insertInto("sender_profiles")
      .values({
        org_id: other.ctx.orgId,
        mailbox_id: other.mailboxId,
        key_hash: forged,
        relation: "known",
        last_seen_at: NOW,
      })
      .execute();
    await db
      .insertInto("sender_suggestions")
      .values({
        org_id: other.ctx.orgId,
        mailbox_id: other.mailboxId,
        key_hash: forged,
        scope: "address",
        kind: "vip",
        pattern: null,
        status: "dismissed",
        ended_at: NOW,
      })
      .execute();
    const otherBefore = await profileHashes(other);
    const otherSuggestions = await suggestionIds(other);

    expect((await erase(w, ANNA)).kind).toBe("erased");
    expect(await profileHashes(other)).toEqual(otherBefore);
    expect(await suggestionIds(other)).toEqual(otherSuggestions);
    expect(await profileHashes(w)).toEqual([hashOf(w.ctx.orgId, BOB)]);
  });

  test("3b the row functions filter by organization on their own (a connection with no tenant scope sees every row)", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    const forged = hashOf(w.ctx.orgId, ANNA);
    await db
      .insertInto("sender_profiles")
      .values({
        org_id: other.ctx.orgId,
        mailbox_id: other.mailboxId,
        key_hash: forged,
        relation: "known",
        last_seen_at: NOW,
      })
      .execute();
    await db
      .insertInto("sender_suggestions")
      .values({
        org_id: other.ctx.orgId,
        mailbox_id: other.mailboxId,
        key_hash: forged,
        scope: "address",
        kind: "vip",
        pattern: null,
        status: "dismissed",
        ended_at: NOW,
      })
      .execute();
    await db.transaction().execute(async (trx) => {
      const rows = await senderContextRowsOf(trx, w.ctx, KEY, ANNA);
      expect(rows.profiles).toHaveLength(2);
      // The forged suggestion of the other organization holds this key, and is not ours.
      expect(rows.suggestions).toEqual([]);
      const deleted = await deleteSenderContextRowsOf(trx, w.ctx, KEY, ANNA);
      expect(deleted).toEqual({ profiles: 2, suggestions: 0 });
    });
    expect(await profileHashes(other)).toContain(forged);
    expect(await suggestionIds(other)).toHaveLength(1);
  });

  test("4 the audit row holds the counts and the address hash, never the address", async () => {
    const w = await seedWorld();
    await suggest(w, { value: ANNA });
    expect((await erase(w, ANNA)).kind).toBe("erased");
    const rows = await db
      .selectFrom("audit_log")
      .select("data")
      .where("org_id", "=", w.ctx.orgId)
      .where("event", "=", auditEvents.dsrErase)
      .execute();
    expect(rows).toHaveLength(1);
    const data = rows[0]?.data as Record<string, unknown>;
    expect(data.sender_profiles).toBe(2);
    expect(data.sender_suggestions).toBe(1);
    expect(data.address_hash).toBe(dsrAddressHash(KEY, ANNA));
    expect(JSON.stringify(data)).not.toMatch(/anna|acme|@/i);
    for (const value of Object.values(data)) expect(["number", "string"]).toContain(typeof value);
  });

  test("5 when all mail of the person goes in the erase, a refresh pass after it writes no row for her", async () => {
    const w = await seedWorld();
    expect((await erase(w, ANNA)).kind).toBe("erased");
    for (const box of [w.mailboxId, w.second.mailboxId]) await pass(w, box);
    expect(await profileHashes(w)).toEqual([hashOf(w.ctx.orgId, BOB)]);
  });

  test("6 a domain suggestion names no person: the erase and the find leave it", async () => {
    const w = await seedWorld();
    const domain = await suggest(w, { value: "@acme.pl", scope: "domain", kind: "whitelist" });
    const found = await find(w, ANNA);
    if (found.kind !== "found") throw new Error("find refused");
    expect(found.counts.sender_suggestions).toBe(0);
    expect((await erase(w, ANNA)).kind).toBe("erased");
    expect(await suggestionIds(w)).toEqual([domain]);
  });

  test("7a a pass that holds the lock finishes first; the erase waits, then deletes the row that the pass wrote", async () => {
    const w = await seedWorld();
    // The seed passes ended: clear the rows so that the open pass below is the only writer of them.
    await db.deleteFrom("sender_profiles").where("org_id", "=", w.ctx.orgId).execute();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = false;
    // Connection 1: the pass reads and writes under its lock and keeps the transaction open.
    const holder = db.transaction().execute(async (trx) => {
      const out = await refreshMailboxProfiles(
        { db: trx, credentialsKey: KEY, testMail: NO_TEST },
        w.ctx,
        w.mailboxId,
        {
          now: NOW,
        }
      );
      expect(out.skipped).toBe(false);
      held = true;
      await gate;
    });
    await waitFor(() => held, "the pass holds the lock");
    // Connection 2: the erase starts and has to wait for the advisory lock.
    let erased = false;
    const eraser = erase(w, ANNA).then((result) => {
      erased = true;
      return result;
    });
    let waiting = false;
    for (let i = 0; i < 200 && !waiting && !erased; i += 1) {
      const { rows } = await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND datname = current_database()`.execute(db);
      waiting = Number(rows[0]?.n) > 0;
      if (!waiting) await Bun.sleep(25);
    }
    expect(waiting).toBe(true);
    expect(erased).toBe(false);
    release();
    await holder;
    const result = await eraser;
    expect(result.kind).toBe("erased");
    expect(await profileHashes(w)).not.toContain(hashOf(w.ctx.orgId, ANNA));
  });

  test("7b while the erase holds the lock, a pass returns skipped", async () => {
    const w = await seedWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = false;
    const eraser = db.transaction().execute(async (trx) => {
      await lockProfilesOfOrg(trx, w.ctx);
      held = true;
      await gate;
    });
    await waitFor(() => held, "the erase holds the locks");
    const out = await pass(w, w.mailboxId);
    expect(out).toEqual({ written: 0, unchanged: 0, zeroed: 0, skipped: true });
    const second = await pass(w, w.second.mailboxId);
    expect(second.skipped).toBe(true);
    release();
    await eraser;
    expect((await pass(w, w.mailboxId)).skipped).toBe(false);
  });
});

describe("the profile locks and the completeness check of the erase", () => {
  test("7c the erase locks the mailboxes of its organization only: a pass of another organization still runs", async () => {
    const w = await seedWorld();
    const other = await seedWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let held = false;
    const eraser = db.transaction().execute(async (trx) => {
      await lockProfilesOfOrg(trx, w.ctx);
      held = true;
      await gate;
    });
    await waitFor(() => held, "the erase holds the locks");
    expect((await pass(w, w.mailboxId)).skipped).toBe(true);
    expect((await pass(other, other.mailboxId)).skipped).toBe(false);
    release();
    await eraser;
  });

  test("9 a profile row that the delete leaves behind stops the erase: nothing changes, no mail goes", async () => {
    const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
    if (ownerUrl === undefined) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role makes the trigger");
    const owner = createDb(ownerUrl);
    const w = await seedWorld();
    const fn = `skip_delete_${w.mailboxId.replaceAll("-", "")}`;
    const mails = async () =>
      (await db.selectFrom("emails").select("id").where("org_id", "=", w.ctx.orgId).execute()).length;
    const before = await mails();
    try {
      // A trigger that turns the DELETE of this organization's profile rows into nothing: the delete reports 0 rows.
      await sql
        .raw(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$`)
        .execute(owner);
      await sql
        .raw(
          `CREATE TRIGGER ${fn} BEFORE DELETE ON sender_profiles FOR EACH ROW
           WHEN (OLD.org_id = '${w.ctx.orgId}') EXECUTE FUNCTION ${fn}()`
        )
        .execute(owner);
      await expect(erase(w, ANNA)).rejects.toThrow("dsr_erase_incomplete");
      expect(await mails()).toBe(before);
      expect(await profileHashes(w)).toContain(hashOf(w.ctx.orgId, ANNA));
    } finally {
      await sql.raw(`DROP TRIGGER IF EXISTS ${fn} ON sender_profiles`).execute(owner);
      await sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`).execute(owner);
      await owner.destroy();
    }
  });
});

describe("org:dsr CLI", () => {
  test("8 the find prints the two sender lines and no address", async () => {
    const key = process.env.CREDENTIALS_KEY;
    if (key === undefined) throw new Error("CREDENTIALS_KEY is missing: the CLI hashes the address with it");
    const w = await seedWorld();
    // The CLI uses the key of the environment, not the test key: the rows get its hash.
    const address = `cli-${randomUUID().slice(0, 8)}@acme.pl`;
    const hash = senderKeyHash(key, w.ctx.orgId, address);
    await db
      .insertInto("sender_profiles")
      .values([
        { org_id: w.ctx.orgId, mailbox_id: w.mailboxId, key_hash: hash, relation: "known", last_seen_at: NOW },
        { org_id: w.ctx.orgId, mailbox_id: w.second.mailboxId, key_hash: hash, relation: "known", last_seen_at: NOW },
      ])
      .execute();
    await db
      .insertInto("sender_suggestions")
      .values({
        org_id: w.ctx.orgId,
        mailbox_id: w.mailboxId,
        key_hash: hash,
        scope: "address",
        kind: "vip",
        pattern: null,
        status: "dismissed",
        ended_at: NOW,
      })
      .execute();
    const proc = Bun.spawn(["bun", script, "--org-id", w.ctx.orgId, "--address", address, "--find"], {
      cwd: repoRoot,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(code).toBe(0);
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toContain("sender profiles 2");
    expect(lines).toContain("sender suggestions 1");
    // Profiles and suggestions alone are a match: no "check the spelling" warning.
    expect(stderr).toBe("");
    expect(stdout + stderr).not.toContain("@");
    expect(stdout + stderr).not.toContain(hash);
  });
});

describe("the address rule of the profile key in a data request", () => {
  // The pass keys a profile on `normalizeAddress` (SQL form): a Greek final sigma and a Turkish dotted capital I give the
  // same key as the address typed in the other case. The find and the erase hash the typed address with the same rule.
  const FOLDS: [string, string][] = [
    ["αννας@χρ.gr", "ΑΝΝΑΣ@ΧΡ.GR"],
    ["İLKER@X.TR", "ilker@x.tr"],
  ];

  async function seedFold(address: string): Promise<World> {
    const world = await db.transaction().execute(async (trx) => {
      const org = await newOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address, mails: [{ at: ago(3) }] });
      return { ...org, second: org };
    });
    orgIds.push(world.ctx.orgId);
    const owner = await db
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", world.ctx.orgId)
      .executeTakeFirst();
    if (owner) userIds.push(owner.user_id);
    await pass(world, world.mailboxId);
    expect(await profileHashes(world)).toHaveLength(1);
    return world;
  }

  test("10 the find counts the profile of a Greek or Turkish address typed in another case", async () => {
    for (const [stored, typed] of FOLDS) {
      const w = await seedFold(stored);
      const found = await find(w, typed);
      expect(found.kind).toBe("found");
      if (found.kind !== "found") continue;
      expect(found.counts.sender_profiles).toBe(1);
    }
  });

  test("11 the erase deletes the profile of a Greek or Turkish address typed in another case", async () => {
    for (const [stored, typed] of FOLDS) {
      const w = await seedFold(stored);
      const result = await erase(w, typed);
      expect(result.kind).toBe("erased");
      if (result.kind !== "erased") continue;
      expect(result.counts.sender_profiles).toBe(1);
      expect(await profileHashes(w)).toEqual([]);
    }
  });
});

describe("an open suggestion that the generator made for a folded address", () => {
  // The suggestion row holds the folded address as its pattern; the erase of the address typed in another case removes it.
  const FOLDS: [string, string][] = [
    ["αννας@acme.pl", "ΑΝΝΑΣ@ACME.PL"],
    ["İLKER@acme.pl", "ilker@acme.pl"],
  ];

  test("15 the find counts it and the erase deletes it, with the profile", async () => {
    for (const [stored, typed] of FOLDS) {
      const world = await db.transaction().execute(async (trx) => {
        const org = await newOrg(trx);
        await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: true, actor: "cli", now: NOW });
        const mails = [1, 2, 3, 4, 5, 6, 7, 8].map((day) => ({ at: ago(day), answered: day <= 6 }));
        await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: stored, mails });
        return { ...org, second: org };
      });
      orgIds.push(world.ctx.orgId);
      const owner = await db
        .selectFrom("memberships")
        .select("user_id")
        .where("org_id", "=", world.ctx.orgId)
        .executeTakeFirst();
      if (owner) userIds.push(owner.user_id);
      await pass(world, world.mailboxId);
      const open = await db
        .selectFrom("sender_suggestions")
        .select("pattern")
        .where("org_id", "=", world.ctx.orgId)
        .where("status", "=", "open")
        .execute();
      expect(open).toHaveLength(1);

      const found = await find(world, typed);
      if (found.kind !== "found") throw new Error("find refused");
      expect(found.counts.sender_profiles).toBe(1);
      expect(found.counts.sender_suggestions).toBe(1);
      const result = await erase(world, typed);
      expect(result.kind).toBe("erased");
      expect(await profileHashes(world)).toEqual([]);
      expect(await suggestionIds(world)).toEqual([]);
    }
  });
});

describe("sender context only, in the find and the CLI", () => {
  // A person with profile rows and nothing else: no mail, no Sent mail, no suggestion. The rows carry the hash of the
  // environment key, because the CLI hashes with it.
  async function seedProfilesOnly(): Promise<{ w: World; address: string; hash: string; key: string }> {
    const key = process.env.CREDENTIALS_KEY;
    if (key === undefined) throw new Error("CREDENTIALS_KEY is missing: the CLI hashes the address with it");
    const w = await seedWorld();
    const address = `solo-${randomUUID().slice(0, 8)}@acme.pl`;
    const hash = senderKeyHash(key, w.ctx.orgId, address);
    await db
      .insertInto("sender_profiles")
      .values([
        { org_id: w.ctx.orgId, mailbox_id: w.mailboxId, key_hash: hash, relation: "known", last_seen_at: NOW },
        { org_id: w.ctx.orgId, mailbox_id: w.second.mailboxId, key_hash: hash, relation: "known", last_seen_at: NOW },
      ])
      .execute();
    return { w, address, hash, key };
  }

  const cli = async (args: string[]) => {
    const proc = Bun.spawn(["bun", script, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
  };

  test("12 profiles alone are a match: the CLI find prints the count and no spelling warning", async () => {
    const { w, address, hash } = await seedProfilesOnly();
    const out = await cli(["--org-id", w.ctx.orgId, "--address", address, "--find"]);
    expect(out.code).toBe(0);
    expect(out.stdout.trimEnd().split("\n")).toContain("sender profiles 2");
    expect(out.stderr).toBe("");
    expect(out.stdout + out.stderr).not.toContain(hash);
  });

  test("13 the find report holds the ids of the profile rows under `sender_context`, and no hash", async () => {
    const { w, address, hash, key } = await seedProfilesOnly();
    const path = join(reportDir, `${randomUUID()}.age`);
    const result = await findSubjectData(db, {
      orgId: w.ctx.orgId,
      address,
      credentialsKey: key,
      now: NOW,
      report: { recipient, out: path },
    });
    expect(result.kind).toBe("found");
    const decrypter = new Decrypter();
    decrypter.addIdentity(identity);
    const text = await decrypter.decrypt(new Uint8Array(await readFile(path)), "text");
    const report = JSON.parse(text) as { sender_context: { profiles: string[]; suggestions: string[] } };
    const ids = (await db.selectFrom("sender_profiles").select("id").where("key_hash", "=", hash).execute()).map(
      (row) => row.id
    );
    expect(ids).toHaveLength(2);
    expect([...report.sender_context.profiles].sort()).toEqual([...ids].sort());
    expect(report.sender_context.suggestions).toEqual([]);
    expect(text).not.toContain(hash);
  });

  test("14 the CLI erase prints the erased profile count, and no address or hash", async () => {
    const { w, address, hash } = await seedProfilesOnly();
    const out = await cli(["--org-id", w.ctx.orgId, "--address", address, "--erase", "--confirm", address]);
    expect(out.code).toBe(0);
    const lines = out.stdout.trimEnd().split("\n");
    expect(lines).toContain("erased sender profiles 2");
    expect(lines).toContain("erased sender suggestions 0");
    expect(out.stdout + out.stderr).not.toContain("@");
    expect(out.stdout + out.stderr).not.toContain(hash);
    const left = await db.selectFrom("sender_profiles").select("id").where("key_hash", "=", hash).execute();
    expect(left).toEqual([]);
  });
});
