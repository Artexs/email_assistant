import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { costPerMail, type CaseText, type LiveRunPlan, type Slot, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { recordLlmCall } from "../../src/modules/audit";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import {
  buildServeParts,
  createLabMailClient,
  createLabState,
  labMailOptions,
  loadLabCorpus,
  serveTick,
  type FakeTgClient,
  type LabCorpus,
  type LabMailClient,
  type LabRun,
  type LabState,
  type ServeDeps,
  type ServeStatus,
} from "../../src/modules/lab";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Needs the shared GreenMail (bun run dev:up) and the DB. Each test uses random addresses and its own state directory.
// The serve wiring runs over the real DB, the real GreenMail client and an in-memory fake Telegram.
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
setDefaultTimeout(30_000);

const db = testDb();
const ROOT = resolve(import.meta.dir, "../../../../evals/sim");
const T0 = new Date("2026-11-23T08:00:00.000Z");
const RUN = "day-20261123-0001";
const MODEL = "gpt-6-luna";

let base: LabCorpus;
beforeAll(async () => {
  base = await loadLabCorpus(ROOT, "lab-01");
});
afterAll(async () => {
  await db.destroy();
});

let dir = "";
let clock = new Date(T0.getTime() + MINUTE_MS);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "f113-s11-int-"));
  clock = new Date(T0.getTime() + MINUTE_MS);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Fixture {
  corpus: LabCorpus;
  plan: LiveRunPlan;
  mailbox: string;
  otherMailbox: string;
}

// One slot due at time zero. The executive address is the run mailbox, so it is in `labAddresses`, like the real mailboxes.
function fixtureOf(suffix: string): Fixture {
  const mailbox = `u-${suffix}@localhost`;
  const personas = base.scenario.personas.map((persona, index) => ({
    ...persona,
    address: `p${index}-${suffix}@lab.test`,
  }));
  const scenario = { ...base.scenario, personas, executive: { ...base.scenario.executive, address: mailbox } };
  const sender = personas.find((persona) => persona.group !== "delegate") as (typeof personas)[number];
  const template = [...base.slots.values()].find(
    (slot) =>
      slot.direction === "in" &&
      slot.parentId === undefined &&
      slot.style.format === "plain" &&
      !slot.hardCases.includes("html_only")
  ) as Slot;
  const slot: Slot = {
    ...template,
    id: "w-1-001",
    hardCases: [],
    headers: {},
    attachments: [],
    thread: [],
    persona: sender.key,
    to: [scenario.executive.key],
    cc: [],
  };
  const text: CaseText = { id: slot.id, subject: "Subject w-1-001", body: "Body of w-1-001", thread: [] };
  const corpus: LabCorpus = {
    scenario,
    manifest: base.manifest,
    slots: new Map([[slot.id, slot]]),
    texts: new Map([[slot.id, text]]),
    parentsOf: () => [],
  };
  const plan: LiveRunPlan = {
    runId: RUN,
    mode: "day",
    startDate: "2026-11-23",
    offsetDays: 0,
    scenarioDays: [1],
    items: [{ slotId: slot.id, at: T0.toISOString() }],
    endsAt: "2026-11-24T08:00:00.000Z",
    tailEndsAt: "2026-12-01T08:00:00.000Z",
    deadlines: [],
  };
  return { corpus, plan, mailbox, otherMailbox: `u2-${suffix}@localhost` };
}

// The fake Telegram knows the chat and holds no card.
const quietTg: FakeTgClient = {
  send: async () => undefined,
  read: async () => [],
  press: async () => undefined,
  hasChat: async () => true,
};

const ledgerLines = (state: LabState): string[] =>
  readFileSync(state.ledgerPath(), "utf8")
    .split("\n")
    .filter((line) => line !== "");

interface World {
  fixture: Fixture;
  state: LabState;
  orgA: { orgId: string; mailboxId: string };
  orgB: { orgId: string; mailboxId: string };
  real: LabMailClient;
  calls: string[];
  serveDeps: (over?: Partial<ServeDeps>) => ServeDeps;
}

// Two orgs: `lab` (the run) and `demo` (another org with its own mailbox, mode and calls).
async function world(trx: Transaction<DB>, run: Partial<LabRun> = {}): Promise<World> {
  const fixture = fixtureOf(randomUUID().slice(0, 8));
  const orgA = await createOrgWithMailbox(trx, { address: fixture.mailbox });
  const orgB = await createOrgWithMailbox(trx, { address: fixture.otherMailbox });
  await insertDefaultSettings(trx, { orgId: orgA.orgId }, orgA.mailboxId);
  await insertDefaultSettings(trx, { orgId: orgB.orgId }, orgB.mailboxId);
  const state = createLabState(dir, () => clock);
  state.writeOrgs({
    lab: { orgId: orgA.orgId, mailboxId: orgA.mailboxId, address: fixture.mailbox, chatId: 1 },
    demo: { orgId: orgB.orgId, mailboxId: orgB.mailboxId, address: fixture.otherMailbox, chatId: 2 },
  });
  expect(state.startRun({ plan: fixture.plan, org: "lab", capUsd: 5, ...run })).toBe("ok");

  // One client for the injector and the bots: the options of the serve wiring on the GreenMail of the test.
  const real = createLabMailClient({ ...labMailOptions(fixture.corpus), host, imapPort, smtpPort });
  const calls: string[] = [];
  const spy: LabMailClient = {
    smtpSend: (input) => {
      calls.push(`smtp:${input.to}`);
      return real.smtpSend(input);
    },
    appendSent: (mailbox, raw) => real.appendSent(mailbox, raw),
    hasMessageId: (mailbox, id) => real.hasMessageId(mailbox, id),
    fetchSince: (mailbox, folder, after) => {
      calls.push(`fetch:${mailbox}`);
      return real.fetchSince(mailbox, folder, after);
    },
    newestUid: (mailbox, folder) => {
      calls.push(`newest:${mailbox}`);
      return real.newestUid(mailbox, folder);
    },
  };
  const { parts, spendOf } = buildServeParts({
    db: trx,
    state,
    corpus: fixture.corpus,
    mail: spy,
    tg: quietTg,
    settings: settingsDeps(trx, () => clock),
    now: () => clock,
  });
  const serveDeps = (over: Partial<ServeDeps> = {}): ServeDeps => ({
    state,
    parts,
    now: () => clock,
    spendUsd: async (runId) => {
      const spend = await spendOf(runId);
      return spend.kind === "unpriced" ? "unpriced" : spend.usd;
    },
    say: () => undefined,
    ...over,
  });
  return { fixture, state, orgA, orgB, real, calls, serveDeps };
}

async function llmCall(trx: Transaction<DB>, org: { orgId: string; mailboxId: string }, at: Date): Promise<void> {
  await recordLlmCall(
    trx,
    { orgId: org.orgId },
    {
      mailboxId: org.mailboxId,
      role: "classifier",
      promptVersion: "test",
      model: MODEL,
      endpoint: "standard",
      provider: "openai" as const,
      outcome: "ok",
      tokensIn: 1000,
      tokensOut: 200,
      latencyMs: 10,
      at,
    }
  );
}

describe("lab serve wiring (stage 11)", () => {
  test("a tick reads the chat and the inboxes before the injector sends; the mail reaches the run mailbox only, once", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const beats: ServeStatus[] = [];
      const errors = new Map<string, number>();
      await serveTick(w.serveDeps({ heartbeat: (status) => beats.push(status) }), errors);

      const types = w.state.events(RUN).map((event) => (event.t === "seen" ? `seen:${event.part}` : event.t));
      expect(types.indexOf("seen:tg")).toBeGreaterThanOrEqual(0);
      expect(types.indexOf("seen:tg")).toBeLessThan(types.indexOf("inject_intent"));
      expect(types.filter((type) => type === "inject_done")).toHaveLength(1);
      expect(types.filter((type) => type.startsWith("seen:uid:")).length).toBeGreaterThan(0);

      const inbox = await w.real.fetchSince(w.fixture.mailbox, "INBOX", 0);
      expect(inbox).toHaveLength(1);
      // The other org's mailbox and every delegate inbox got nothing.
      expect(await w.real.fetchSince(w.fixture.otherMailbox, "INBOX", 0)).toEqual([]);
      for (const persona of w.fixture.corpus.scenario.personas.filter((p) => p.group === "delegate")) {
        expect(await w.real.fetchSince(persona.address, "INBOX", 0)).toEqual([]);
      }
      // One shared client served both ticks: the injector sent, the bots read their inboxes through it.
      expect(w.calls.filter((call) => call.startsWith("smtp:"))).toEqual([`smtp:${w.fixture.mailbox}`]);
      expect(w.calls.some((call) => call.startsWith("newest:p"))).toBe(true);

      // A second tick injects nothing more.
      await serveTick(w.serveDeps(), errors);
      expect(await w.real.fetchSince(w.fixture.mailbox, "INBOX", 0)).toHaveLength(1);
      expect(w.state.events(RUN).filter((event) => event.t === "inject_done")).toHaveLength(1);
      expect(beats[0]).toEqual({ tickAt: clock.toISOString(), runs: { [RUN]: {} } });
    });
  });

  test("at the tail end the run finishes with done: one ledger line with the spend of the run org only", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx);
      const at = new Date(T0.getTime() + 10 * MINUTE_MS);
      await llmCall(trx, w.orgA, at);
      await llmCall(trx, w.orgA, at);
      // Five calls of the other org: they never count.
      for (let index = 0; index < 5; index += 1) await llmCall(trx, w.orgB, at);
      await serveTick(w.serveDeps(), new Map());
      expect(w.state.activeRuns()).toEqual([RUN]);

      clock = new Date("2026-12-01T08:00:00.000Z");
      await serveTick(w.serveDeps(), new Map());
      const lines = ledgerLines(w.state);
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0] as string) as { runId: string; usd: number; label: string };
      const one = costPerMail(MODEL, 1000, 200, at) as number;
      expect(line.runId).toBe(RUN);
      expect(line.usd).toBeCloseTo(2 * one, 12);
      expect(line.label).toBe("lab-01-live-done");
      expect(w.state.events(RUN).filter((event) => event.t === "stopped")).toMatchObject([{ reason: "done" }]);
      expect(w.state.activeRuns()).toEqual([]);
    });
  });

  test("the spend at the cap stops the run before any part runs", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { capUsd: 0.0001 });
      await llmCall(trx, w.orgA, new Date(T0.getTime() + 5 * MINUTE_MS));
      await serveTick(w.serveDeps(), new Map());
      expect(w.state.events(RUN).filter((event) => event.t === "stopped")).toMatchObject([{ reason: "budget" }]);
      expect(w.state.events(RUN).some((event) => event.t === "inject_intent" || event.t === "seen")).toBe(false);
      expect(w.calls).toEqual([]);
      expect(ledgerLines(w.state)).toHaveLength(1);
    });
  });

  test("the demo mode switch changes the mailbox of the run org only, once", async () => {
    await withRollback(db, async (trx) => {
      const w = await world(trx, { org: "lab", modePlan: { assistFromDay: 4 } });
      const modeOf = async (org: { orgId: string; mailboxId: string }) =>
        (await getMailboxSettings(trx, { orgId: org.orgId }, org.mailboxId))?.mode;
      expect(await modeOf(w.orgA)).toBe("shadow");

      // Wednesday 23:59 Warsaw: day 3.
      clock = new Date("2026-11-25T22:59:00.000Z");
      await serveTick(w.serveDeps(), new Map());
      expect(await modeOf(w.orgA)).toBe("shadow");

      // Thursday 00:30 Warsaw: day 4.
      clock = new Date("2026-11-25T23:30:00.000Z");
      await serveTick(w.serveDeps(), new Map());
      await serveTick(w.serveDeps(), new Map());
      expect(await modeOf(w.orgA)).toBe("assist");
      expect(await modeOf(w.orgB)).toBe("shadow");
      expect(w.state.events(RUN).filter((event) => event.t === "mode")).toMatchObject([{ mode: "assist" }]);
    });
  });
});
