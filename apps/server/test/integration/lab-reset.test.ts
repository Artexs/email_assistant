import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { sql } from "kysely";

import { settingsDeps } from "../../src/composition";
import { consumeLinkToken } from "../../src/modules/channels";
import { getMailboxSettings } from "../../src/modules/config";
import { listDelegates } from "../../src/modules/delegation";
import {
  createLabMailClient,
  createLabState,
  createOrgLookup,
  LAB_IMAP_PORT,
  LAB_MAIL_PASSWORD,
  LAB_SMTP_PORT,
  LAB_TARGETS,
  labAddresses,
  LabMailError,
  LabResetError,
  loadLabCorpus,
  orgHasMail,
  previewReset,
  resetDemo,
  resetOrg,
  runSpend,
  seedLabOrg,
  startLabRun,
  storeRunUrgencyProfile,
  type FakeTgClient,
  type LabCorpus,
  type LabOrgKey,
  type LabState,
  type ResetDeps,
  type SeedTarget,
} from "../../src/modules/lab";
import { renderSeedMessage, type ConnectDeps } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { deleteOrganization } from "../../src/modules/privacy";
import { addMember, createOrganizationWithOwner } from "../../src/modules/tenancy";
import { createSecretBox } from "../../src/platform/crypto";

import {
  insertAction,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  randomChatId,
  testCapabilities,
} from "./fixtures";
import { testDb } from "./helpers";

// The reset of a lab organization. It deletes data, so every test runs on test organizations of the
// test DB (committed: the delete function opens its own transaction) and on random GreenMail addresses. The
// organizations of a test are removed in `afterEach`. No test names a real organization or a real mailbox.
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? String(LAB_IMAP_PORT));
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? String(LAB_SMTP_PORT));
// One GreenMail login takes about 250 ms and a reset makes several: the default 5 s is too short by design.
setDefaultTimeout(MINUTE_MS);

const db = testDb();
const SIM_ROOT = resolve(import.meta.dir, "../../../../evals/sim");
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
// A Friday: the default week start is Monday 2026-11-23.
const NOW = new Date("2026-11-20T08:00:00.000Z");
const MARK = "f113s14";

let corpus: LabCorpus;
beforeAll(async () => {
  corpus = await loadLabCorpus(SIM_ROOT, "lab-01");
});

const orgIds: string[] = [];
const dirs: string[] = [];
afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds.splice(0)).execute();
  await db.deleteFrom("users").where("email", "like", `${MARK}-%`).execute();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await db.destroy();
});

async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (true) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() >= deadline) throw new Error(`eventually: ${what}`);
    await Bun.sleep(50);
  }
}

interface World {
  dir: string;
  state: LabState;
  targets: Record<LabOrgKey, SeedTarget>;
  mail: ReturnType<typeof createLabMailClient>;
  deps: ResetDeps;
  // The orgs the delete function was asked to delete.
  deleteCalls: string[];
  // Set to make the delete function (or the mailbox step) fail after it did its work: a crash.
  crashAfterDelete: { on: boolean };
  hexes: string[];
}

// Random targets with the real org names: the guards compare against the names the target gives.
function randomTargets(): Record<LabOrgKey, SeedTarget> {
  return {
    lab: { ...LAB_TARGETS.lab, mailbox: `${MARK}-lab-${randomUUID()}@kordelan.test`, chatId: randomChatId() },
    demo: { ...LAB_TARGETS.demo, mailbox: `${MARK}-demo-${randomUUID()}@kordelan.test`, chatId: randomChatId() },
  };
}

function world(): World {
  const dir = mkdtempSync(join(tmpdir(), "f113-s14-reset-"));
  dirs.push(dir);
  const now = () => NOW;
  const state = createLabState(dir, now);
  const targets = randomTargets();
  const mail = createLabMailClient({
    host,
    imapPort,
    smtpPort,
    password: LAB_MAIL_PASSWORD,
    allowedAddresses: new Set([...labAddresses(corpus), targets.lab.mailbox, targets.demo.mailbox]),
  });

  // The fake Telegram and the server runtime in one object: `/start <token>` links the chat.
  const chats = new Set<number>();
  const tg: FakeTgClient = {
    async send(chatId, text) {
      chats.add(chatId);
      if (text.startsWith("/start ")) {
        await consumeLinkToken(db, { token: text.slice("/start ".length), chatId, now: now() });
      }
    },
    read: async () => [],
    press: async () => undefined,
    hasChat: async (chatId) => chats.has(chatId),
  };
  const connect: ConnectDeps = {
    db,
    secrets,
    openProvider: async () => createFakeMailProvider(),
    verifySmtp: async () => undefined,
  };
  const deleteCalls: string[] = [];
  const crashAfterDelete = { on: false };
  const hexes = ["aaaa", "bbbb", "cccc", "dddd", "eeee"];
  const deps: ResetDeps = {
    targets,
    lookupOrg: createOrgLookup(db),
    state,
    mail,
    deleteOrg: async ({ orgId, confirmName, expect }) => {
      deleteCalls.push(orgId);
      const result = await deleteOrganization(db, { orgId, confirmName, expect, via: "cli" });
      if (crashAfterDelete.on) throw new Error("crash after the delete");
      return result;
    },
    seed: async (target) => {
      const result = await seedLabOrg(
        {
          db,
          connect,
          settings: settingsDeps(db, now),
          state,
          tg,
          now,
          sleep: async () => undefined,
          linkTimeoutMs: 5000,
          pollMs: 1,
        },
        corpus.scenario,
        target
      );
      orgIds.push(result.org.orgId);
      return result;
    },
    spendOf: async (runId) => {
      const run = state.readRun(runId);
      const org = state.readOrgs()[run.org];
      if (org === undefined) throw new Error("the run org is not in orgs.json");
      return runSpend(db, org.orgId, run);
    },
    start: (input) =>
      startLabRun(input, {
        state,
        corpus,
        models: [{ model: "gpt-6-luna", endpoint: "standard" }],
        orgHasMail: (orgId) => orgHasMail(db, orgId),
        storeUrgency: (org, plan) => storeRunUrgencyProfile({ db, scenario: corpus.scenario }, org, plan),
        now,
        hex4: () => hexes.shift() ?? "ffff",
      }),
    now,
  };
  return { dir, state, targets, mail, deps, deleteCalls, crashAfterDelete, hexes };
}

// Mail into the INBOX of `to` (SMTP) and into its Sent folder (APPEND); waits until GreenMail shows it.
async function fill(w: World, to: string, inbox: number, sent: number): Promise<void> {
  const from = corpus.scenario.personas[0]?.address as string;
  for (let i = 0; i < inbox + sent; i += 1) {
    const raw = renderSeedMessage({
      messageId: `<${MARK}.${randomUUID()}@kordelan.test>`,
      from,
      to: [to],
      subject: `subject ${i}`,
      date: NOW,
      text: "text",
    });
    if (i < inbox) await w.mail.smtpSend({ envelopeFrom: from, to, raw });
    else await w.mail.appendSent(to, raw);
  }
  await eventually(
    () => w.mail.countMessages(to),
    (n) => n === inbox + sent,
    `${inbox + sent} mails in ${MARK}`
  );
}

// Rows of an organization in every table with an `org_id` column (and `organizations` itself), by table name.
async function rowCounts(orgId: string): Promise<Record<string, number>> {
  const tables = await sql<{ table_name: string }>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name`.execute(db);
  const counts: Record<string, number> = {};
  for (const { table_name: table } of tables.rows) {
    const row = await sql<{
      n: string;
    }>`SELECT count(*) AS n FROM ${sql.id(table)} WHERE org_id = ${orgId}::uuid`.execute(db);
    counts[table] = Number(row.rows[0]?.n);
  }
  const own = await sql<{ n: string }>`SELECT count(*) AS n FROM organizations WHERE id = ${orgId}::uuid`.execute(db);
  counts.organizations = Number(own.rows[0]?.n);
  return counts;
}

// Gives an org real-looking load: mails, a draft and a send, a delegation (one row in each of three tables and more).
async function addLoad(orgId: string, mailboxId: string, mails = 1): Promise<void> {
  const ctx = { orgId };
  const delegate = (await listDelegates(db, ctx))[0];
  if (delegate === undefined) throw new Error("the seeded org has no delegate");
  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < mails; i += 1) {
      const emailId = await insertTestEmail(trx, ctx, mailboxId);
      await insertAction(trx, ctx, emailId, { type: "move", status: "applied" });
    }
    const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctx, mailboxId, { delegateId: delegate.id });
    await insertDelegation(trx, ctx, {
      mailboxId,
      emailId,
      delegateId: delegate.id,
      draftActionId: draftId,
      sendActionId: sendId,
    });
  });
}

const orgOf = (w: World, key: LabOrgKey) => {
  const org = w.state.readOrgs()[key];
  if (org === undefined) throw new Error(`no ${key} org in orgs.json`);
  return org;
};

const orgsNamed = async (name: string, ownerEmail: string): Promise<number> =>
  Number(
    (
      await sql<{ n: string }>`
        SELECT count(*) AS n FROM organizations o
        JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id
        WHERE o.name = ${name} AND u.email = ${ownerEmail}`.execute(db)
    ).rows[0]?.n
  );

const stoppedReason = (w: World, runId: string): string | undefined => {
  const event = w.state.events(runId).find((candidate) => candidate.t === "stopped");
  return event?.t === "stopped" ? event.reason : undefined;
};

describe("resetOrg and resetDemo (F113 stage 14)", () => {
  test("1: the first demo reset makes one demo org in shadow and a week run with assist from day 4", async () => {
    const w = world();
    expect(w.state.readOrgs().demo).toBeUndefined();
    const result = await resetDemo(w.deps, {});
    const demo = orgOf(w, "demo");
    expect(demo.orgId).toBe(result.orgId);
    expect(w.deleteCalls).toEqual([]);
    expect(await orgsNamed("Kordelan demo", w.targets.demo.mailbox)).toBe(1);
    expect((await getMailboxSettings(db, { orgId: demo.orgId }, demo.mailboxId))?.mode).toBe("shadow");
    const run = w.state.readRun(result.runId);
    expect(run).toMatchObject({ org: "demo", modePlan: { assistFromDay: 4 } });
    expect(run.plan.mode).toBe("week");
    expect(run.plan.runId).toBe("week-20261123-aaaa");
    expect(w.state.activeRuns()).toEqual([result.runId]);
  });

  test("1b: reset of a lab org with 3 mails gives a fresh lab org with 0 mails in assist; start then passes org_not_fresh", async () => {
    const w = world();
    await resetOrg(w.deps, "lab");
    const before = orgOf(w, "lab");
    await addLoad(before.orgId, before.mailboxId, 2);
    // 2 mails plus the delegation mail.
    expect(await orgHasMail(db, before.orgId)).toBe(true);
    expect(await countEmails(before.orgId)).toBe(3);
    const refused = await w.deps.start({ mode: "day", org: "lab", reuse: false, date: "2026-11-23" });
    expect(refused).toMatchObject({ kind: "refused", code: "org_not_fresh" });

    const result = await resetOrg(w.deps, "lab");
    expect(result.deleted).toBe(true);
    const after = orgOf(w, "lab");
    expect(after.orgId).not.toBe(before.orgId);
    expect(await countEmails(after.orgId)).toBe(0);
    expect((await getMailboxSettings(db, { orgId: after.orgId }, after.mailboxId))?.mode).toBe("assist");
    const started = await w.deps.start({ mode: "day", org: "lab", reuse: false, date: "2026-11-23" });
    expect(started.kind).toBe("started");
  });

  test("2: a second reset deletes the old org with its rows, makes one new org and a new run; the old run is stopped: operator", async () => {
    const w = world();
    const first = await resetDemo(w.deps, {});
    const old = orgOf(w, "demo");
    await addLoad(old.orgId, old.mailboxId, 2);
    const oldCounts = await rowCounts(old.orgId);
    expect(oldCounts.emails).toBeGreaterThan(0);
    expect(oldCounts.actions).toBeGreaterThan(0);
    expect(oldCounts.delegations).toBe(1);

    const second = await resetDemo(w.deps, {});
    expect(w.deleteCalls).toEqual([old.orgId]);
    // Every table: no row of the old org is left, and the organization row is gone.
    expect(Object.values(await rowCounts(old.orgId)).every((n) => n === 0)).toBe(true);
    expect(second.orgId).not.toBe(old.orgId);
    expect(orgOf(w, "demo").orgId).toBe(second.orgId);
    expect(await orgsNamed("Kordelan demo", w.targets.demo.mailbox)).toBe(1);
    expect(second.runId).not.toBe(first.runId);
    expect(stoppedReason(w, first.runId)).toBe("operator");
    expect(stoppedReason(w, second.runId)).toBeUndefined();
    expect(w.state.activeRuns()).toEqual([second.runId]);
    // The ledger got one line for the old run before its org rows went.
    expect(readFileSync(w.state.ledgerPath(), "utf8")).toContain(first.runId);
  });

  test("3: the other lab org, its mailbox and its run are the same after a reset: every table with org_id, row for row", async () => {
    const w = world();
    await resetOrg(w.deps, "lab");
    const lab = orgOf(w, "lab");
    await addLoad(lab.orgId, lab.mailboxId, 3);
    await fill(w, w.targets.lab.mailbox, 2, 1);
    expect(w.state.startRun({ plan: (await startPlan(w)).plan, org: "lab", capUsd: 1 })).toBe("ok");
    const labRun = w.state.activeRuns()[0] as string;
    const before = await rowCounts(lab.orgId);
    // Several tables hold rows (emails, actions, delegations, mailboxes, delegates ...): the check covers them all.
    expect(Object.entries(before).filter(([, n]) => n > 0).length).toBeGreaterThan(8);

    await resetDemo(w.deps, {});
    await addLoad(orgOf(w, "demo").orgId, orgOf(w, "demo").mailboxId, 2);
    await fill(w, w.targets.demo.mailbox, 1, 1);
    await resetDemo(w.deps, {});

    expect(w.deleteCalls).toHaveLength(1);
    expect(w.deleteCalls).not.toContain(lab.orgId);
    expect(await rowCounts(lab.orgId)).toEqual(before);
    expect(orgOf(w, "lab")).toEqual(lab);
    expect(await w.mail.countMessages(w.targets.lab.mailbox)).toBe(3);
    expect(w.state.events(labRun).some((event) => event.t === "stopped")).toBe(false);
    expect(w.state.activeRuns()).toContain(labRun);
  });

  test("4: after the reset the demo mailbox has 0 mails in INBOX and Sent; the lab mailbox keeps its mails", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    await fill(w, w.targets.demo.mailbox, 3, 2);
    await fill(w, w.targets.lab.mailbox, 1, 1);
    expect(await w.mail.fetchSince(w.targets.demo.mailbox, "INBOX", 0)).toHaveLength(3);
    expect(await w.mail.fetchSince(w.targets.demo.mailbox, "Sent", 0)).toHaveLength(2);

    await resetDemo(w.deps, {});
    expect(await w.mail.fetchSince(w.targets.demo.mailbox, "INBOX", 0)).toHaveLength(0);
    expect(await w.mail.fetchSince(w.targets.demo.mailbox, "Sent", 0)).toHaveLength(0);
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(0);
    expect(await w.mail.countMessages(w.targets.lab.mailbox)).toBe(2);
  });
});

async function countEmails(orgId: string): Promise<number> {
  return Number(
    (
      await db
        .selectFrom("emails")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("org_id", "=", orgId)
        .executeTakeFirstOrThrow()
    ).n
  );
}

// A planned run for the org `lab`, built the way `start` does (the state wants a plan).
async function startPlan(w: World) {
  const result = await w.deps.start({ mode: "day", org: "lab", reuse: true, date: "2026-11-23" });
  if (result.kind !== "started") throw new Error(`start refused: ${result.code}`);
  // `start` made the run: end it here and hand its plan to a run that stays active under another id.
  w.state.stopRun(result.run.plan.runId, "operator");
  return { plan: { ...result.run.plan, runId: "day-20261123-zzzz" } };
}

// A real-looking organization the lab must never delete: its own name, owner and (a) mailbox rows.
async function realOrg(name: string, mailboxes: string[]) {
  const suffix = randomUUID();
  const { orgId } = await createOrganizationWithOwner(db, {
    orgName: name,
    timezone: "Europe/Warsaw",
    email: `${MARK}-owner-${suffix}@x.test`,
    displayName: "Real Owner",
    locale: "en",
  });
  orgIds.push(orgId);
  const ids: string[] = [];
  for (const address of mailboxes) {
    const id = randomUUID();
    ids.push(id);
    await insertMailbox(
      db,
      { orgId },
      {
        id,
        address,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      }
    );
    await insertInboxFolder(db, { orgId }, id);
  }
  await db.transaction().execute((trx) => insertTestEmail(trx, { orgId }, ids[0] as string));
  return { orgId, mailboxId: ids[0] as string };
}

describe("the guards of the reset (F113 stage 14): each alone refuses, and nothing changes", () => {
  interface Spec {
    name: string;
    // The mailbox rows of the other org and the address `orgs.json` holds for it, from the target of the world.
    mailboxes: (target: SeedTarget) => string[];
    entryAddress: (target: SeedTarget) => string;
  }

  // A demo world with a run and mail; then `orgs.json` names another org (a real one, made here) as the demo org.
  async function guarded(spec: Spec) {
    const w = world();
    const first = await resetDemo(w.deps, {});
    await fill(w, w.targets.demo.mailbox, 2, 1);
    const demo = orgOf(w, "demo");
    const demoBefore = await rowCounts(demo.orgId);
    const org = await realOrg(spec.name, spec.mailboxes(w.targets.demo));
    w.state.writeOrgs({
      ...w.state.readOrgs(),
      demo: { ...org, address: spec.entryAddress(w.targets.demo), chatId: demo.chatId },
    });
    return { w, runId: first.runId, demo, demoBefore, org };
  }

  async function expectRefused(setup: Awaited<ReturnType<typeof guarded>>, call: () => Promise<unknown>) {
    const { w, runId, org } = setup;
    const orgsBefore = readFileSync(join(w.dir, "orgs.json"), "utf8");
    const before = await rowCounts(org.orgId);
    await expect(call()).rejects.toMatchObject({ code: "org_mismatch" });
    // The refusal came before the first change: no delete call, the org and its rows, the mail, the run and orgs.json.
    expect(w.deleteCalls).toEqual([]);
    expect(await rowCounts(org.orgId)).toEqual(before);
    expect(before.organizations).toBe(1);
    expect(w.state.events(runId).some((event) => event.t === "stopped")).toBe(false);
    expect(w.state.activeRuns()).toEqual([runId]);
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(3);
    expect(readFileSync(join(w.dir, "orgs.json"), "utf8")).toBe(orgsBefore);
    expect(await rowCounts(setup.demo.orgId)).toEqual(setup.demoBefore);
  }

  const asDemo = (target: SeedTarget) => target.mailbox;

  test("5: the demo entry names an org called Kordelan lab: org_mismatch, nothing is deleted", async () => {
    // The name is the only wrong part: the mailbox rows and the entry address are the demo ones.
    const setup = await guarded({ name: "Kordelan lab", mailboxes: (t) => [asDemo(t)], entryAddress: asDemo });
    await expectRefused(setup, () => resetOrg(setup.w.deps, "demo"));
    await expectRefused(setup, () => resetDemo(setup.w.deps, {}));
    await expectRefused(setup, () => previewReset(setup.w.deps, "demo"));
  });

  // The next three cases break one guard each: the other two hold.
  test("5a: guard 1 (name): a real org with another name, the right mailbox row and the right entry address", async () => {
    const setup = await guarded({
      name: "Real Company Sp. z o.o.",
      mailboxes: (t) => [asDemo(t)],
      entryAddress: asDemo,
    });
    await expectRefused(setup, () => resetOrg(setup.w.deps, "demo"));
  });

  test("5b: guard 2 (entry address): the right name and mailbox row, but orgs.json holds another address", async () => {
    const setup = await guarded({
      name: "Kordelan demo",
      mailboxes: (t) => [asDemo(t)],
      entryAddress: () => `${MARK}-elsewhere@kordelan.test`,
    });
    await expectRefused(setup, () => resetOrg(setup.w.deps, "demo"));
  });

  test("5c: guard 3 (mailbox rows): the right name and entry address, but the org has a real mailbox", async () => {
    const real = () => `ceo-${randomUUID()}@realcompany.example`;
    const setup = await guarded({ name: "Kordelan demo", mailboxes: (t) => [asDemo(t), real()], entryAddress: asDemo });
    await expectRefused(setup, () => resetOrg(setup.w.deps, "demo"));
    // An org with only a real mailbox is refused too.
    const only = await guarded({ name: "Kordelan demo", mailboxes: () => [real()], entryAddress: asDemo });
    await expectRefused(only, () => resetOrg(only.w.deps, "demo"));
  });

  test("5d: the mail guard: a mailbox outside the allowed addresses is refused before the org is deleted", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    const demo = orgOf(w, "demo");
    const outside = `${MARK}-outside-${randomUUID()}@realcompany.example`;
    // The four org guards pass for the target `outside` (name, entry address, mailbox row and member email); only the mail client refuses.
    await db.updateTable("mailboxes").set({ address: outside }).where("id", "=", demo.mailboxId).execute();
    await db.updateTable("users").set({ email: outside }).where("email", "=", w.targets.demo.mailbox).execute();
    w.state.writeOrgs({ ...w.state.readOrgs(), demo: { ...demo, address: outside } });
    const bad: ResetDeps = { ...w.deps, targets: { ...w.targets, demo: { ...w.targets.demo, mailbox: outside } } };
    await expect(resetOrg(bad, "demo")).rejects.toMatchObject({ code: "address_refused" });
    expect(w.deleteCalls).toEqual([]);
    expect((await rowCounts(demo.orgId)).organizations).toBe(1);
    expect(w.state.activeRuns()).toHaveLength(1);
    // The client itself refuses both mailbox calls.
    await expect(w.mail.emptyMailbox(outside)).rejects.toMatchObject({ code: "address_refused" });
    await expect(w.mail.countMessages(outside)).rejects.toMatchObject({ code: "address_refused" });
  });

  // The member email of the org must be the demo mailbox address.
  async function addOtherMember(orgId: string): Promise<void> {
    const added = await addMember(
      db,
      { orgId },
      {
        email: `${MARK}-member-${randomUUID()}@x.test`,
        displayName: "Other Member",
        role: "assistant",
        locale: "en",
        actor: "test",
        now: NOW,
      }
    );
    expect(added.kind).toBe("added");
  }

  test("5e: guard 4 (members): a member with another email refuses, also for an org with no mailbox row", async () => {
    const w = world();
    const first = await resetDemo(w.deps, {});
    await fill(w, w.targets.demo.mailbox, 2, 1);
    const demo = orgOf(w, "demo");
    await addOtherMember(demo.orgId);
    let before = await rowCounts(demo.orgId);
    const orgsBefore = readFileSync(join(w.dir, "orgs.json"), "utf8");
    const check = async () => {
      await expect(resetOrg(w.deps, "demo")).rejects.toMatchObject({ code: "org_mismatch" });
      await expect(previewReset(w.deps, "demo")).rejects.toMatchObject({ code: "org_mismatch" });
      expect(w.deleteCalls).toEqual([]);
      expect(await rowCounts(demo.orgId)).toEqual(before);
      expect(w.state.activeRuns()).toEqual([first.runId]);
      expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(3);
      expect(readFileSync(join(w.dir, "orgs.json"), "utf8")).toBe(orgsBefore);
    };
    await check();
    // The repair case (no mailbox row) does not skip the member check.
    await db.deleteFrom("mailboxes").where("id", "=", demo.mailboxId).execute();
    before = await rowCounts(demo.orgId);
    expect(before.mailboxes).toBe(0);
    await check();
  });

  // The guards ran before the delete transaction; a row that commits in the window must not be deleted with the org
  // `lookupOrg` is the last read of the pre-check: the hook adds the row right after it.
  async function lateInsert(add: (orgId: string) => Promise<void>) {
    const w = world();
    const first = await resetDemo(w.deps, {});
    await fill(w, w.targets.demo.mailbox, 2, 1);
    const demo = orgOf(w, "demo");
    let armed = true;
    const late: ResetDeps = {
      ...w.deps,
      lookupOrg: async (orgId) => {
        const row = await w.deps.lookupOrg(orgId);
        if (armed) {
          armed = false;
          await add(orgId);
        }
        return row;
      },
    };
    const orgsBefore = readFileSync(join(w.dir, "orgs.json"), "utf8");
    await expect(resetOrg(late, "demo")).rejects.toMatchObject({ code: "org_mismatch" });
    // The delete function was asked and refused inside its transaction: the org and all its rows are there.
    expect(w.deleteCalls).toEqual([demo.orgId]);
    expect((await rowCounts(demo.orgId)).organizations).toBe(1);
    expect((await rowCounts(demo.orgId)).emails).toBe(0);
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(3);
    expect(readFileSync(join(w.dir, "orgs.json"), "utf8")).toBe(orgsBefore);
    return { w, first, demo };
  }

  test("5f: a mailbox row that commits after the pre-check is not deleted: the delete refuses inside its transaction", async () => {
    const { demo } = await lateInsert(async (orgId) => {
      const id = randomUUID();
      await insertMailbox(
        db,
        { orgId },
        {
          id,
          address: `ceo-${randomUUID()}@realcompany.example`,
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: testCapabilities,
          folderMap: {},
        }
      );
    });
    expect((await rowCounts(demo.orgId)).mailboxes).toBe(2);
  });

  test("5g: a member that commits after the pre-check is not deleted: the delete refuses inside its transaction", async () => {
    const { demo } = await lateInsert(addOtherMember);
    expect((await rowCounts(demo.orgId)).memberships).toBe(2);
  });

  test("6: an org with no mailbox row passes guard 3 (a repair case): the reset deletes it", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    const demo = orgOf(w, "demo");
    await db.deleteFrom("mailboxes").where("id", "=", demo.mailboxId).execute();
    const again = await resetDemo(w.deps, {});
    expect(w.deleteCalls).toEqual([demo.orgId]);
    expect(orgOf(w, "demo").orgId).toBe(again.orgId);
  });
});

describe("crash and repeat (F113 stage 14)", () => {
  test("7: a crash after the delete (before orgs.json changes): the next reset ends with one demo org", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    const old = orgOf(w, "demo");
    await fill(w, w.targets.demo.mailbox, 2, 0);
    w.crashAfterDelete.on = true;
    await expect(resetOrg(w.deps, "demo")).rejects.toThrow("crash after the delete");
    // The org is gone and the entry still names it: the next call skips the delete and goes on.
    expect((await rowCounts(old.orgId)).organizations).toBe(0);
    expect(orgOf(w, "demo").orgId).toBe(old.orgId);
    w.crashAfterDelete.on = false;

    const again = await resetDemo(w.deps, {});
    expect(w.deleteCalls).toEqual([old.orgId]);
    expect(orgOf(w, "demo").orgId).toBe(again.orgId);
    expect(await orgsNamed("Kordelan demo", w.targets.demo.mailbox)).toBe(1);
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(0);
  });

  test("7b: a crash between the delete and the seed (no entry, old mail left): the next reset empties the mailbox and seeds one org", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    await fill(w, w.targets.demo.mailbox, 2, 1);
    const real = w.mail;
    let failures = 1;
    const flaky: ResetDeps = {
      ...w.deps,
      mail: {
        countMessages: (mailbox) => real.countMessages(mailbox),
        emptyMailbox: async (mailbox) => {
          if (failures-- > 0) throw new LabMailError("imap_fetch");
          return real.emptyMailbox(mailbox);
        },
      },
    };
    await expect(resetOrg(flaky, "demo")).rejects.toBeInstanceOf(LabMailError);
    // The org is deleted and the entry removed; the mail is still there.
    expect(w.state.readOrgs().demo).toBeUndefined();
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(3);

    const again = await resetOrg(flaky, "demo");
    expect(again.deleted).toBe(false);
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(0);
    expect(await orgsNamed("Kordelan demo", w.targets.demo.mailbox)).toBe(1);
    expect(orgOf(w, "demo").orgId).toBe(again.orgId);
  });

  test("8: previewReset names the org, the mailbox and the mail count and changes nothing", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    await fill(w, w.targets.demo.mailbox, 2, 1);
    const demo = orgOf(w, "demo");
    const before = await rowCounts(demo.orgId);
    expect(await previewReset(w.deps, "demo")).toEqual({
      orgId: demo.orgId,
      mailbox: w.targets.demo.mailbox,
      messages: 3,
    });
    expect(await rowCounts(demo.orgId)).toEqual(before);
    expect(w.deleteCalls).toEqual([]);
    expect(await w.mail.countMessages(w.targets.demo.mailbox)).toBe(3);
    // No entry: the preview names no org.
    const fresh = world();
    expect(await previewReset(fresh.deps, "lab")).toEqual({
      orgId: undefined,
      mailbox: fresh.targets.lab.mailbox,
      messages: 0,
    });
  });

  test("9: a delete that the privacy function refuses (name_mismatch) is delete_refused, not a silent go-on", async () => {
    const w = world();
    await resetDemo(w.deps, {});
    const refusing: ResetDeps = { ...w.deps, deleteOrg: async () => ({ kind: "name_mismatch" }) };
    await expect(resetOrg(refusing, "demo")).rejects.toMatchObject({ code: "delete_refused" });
    expect(w.state.readOrgs().demo).toBeDefined();
    const busy: ResetDeps = { ...w.deps, deleteOrg: async () => ({ kind: "busy" }) };
    const error = await resetOrg(busy, "demo").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabResetError);
    expect((error as LabResetError).code).toBe("delete_busy");
  });
});
