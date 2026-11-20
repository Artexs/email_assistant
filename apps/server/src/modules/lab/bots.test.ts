import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { otherAddressOf, type LiveRunPlan, type SimPersona, type Slot } from "@ea/core";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { INBOX, renderSeedMessage } from "../mail";

import { MAX_ERRORS_PER_REPLY, runDelegateBotsTick, type BotDeps, type BotTickResult } from "./bots";
import type { LabCorpus } from "./corpus";
import { LabMailError } from "./mail-client";
import { createFakeLabMailClient, type FakeLabMailClient } from "./mail-client.test-helper";
import { createLabState, type LabEvent, type LabState } from "./state";

// The delegate bots over the in-memory mail client: no mail server, no database. The cases that need a real IMAP server
// (a real read of the delegate inbox after a restart, a move between folders) stay in the integration suite.

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// Monday 2026-11-23: Warsaw is UTC+1.
const MON_10 = new Date("2026-11-23T09:00:00.000Z");
const MON_09 = new Date("2026-11-23T08:00:00.000Z");
const WED_NOON = new Date("2026-11-25T11:00:00.000Z");
const FAR = new Date("2026-12-31T12:00:00.000Z");

interface World {
  runId: string;
  runMailbox: string;
  delegate: SimPersona;
  other: SimPersona; // another delegate persona with its own inbox
  mail: FakeLabMailClient;
  state: LabState;
  deps: BotDeps;
  clock: { now: Date };
  events: () => LabEvent[];
  // A mail the sim server would send to the delegate: From the run mailbox unless `from` says otherwise.
  sendToDelegate(input: {
    id: string;
    references: string[];
    date: Date;
    subject?: string;
    from?: string;
    headers?: Record<string, string>;
  }): void;
  labId(slotId: string): string;
}

const SUBJECT_CANARY = "CANARY-subject-5d1c";
const BODY_CANARY = "CANARY-body-8f3e";

function slotOf(id: string, fields: Partial<Slot>): Slot {
  return { id, persona: "x", direction: "received", hardCases: [], to: [], cc: [], ...fields } as unknown as Slot;
}

function makeWorld(): World {
  const dir = mkdtempSync(join(tmpdir(), "lab-bots-"));
  dirs.push(dir);
  const suffix = randomUUID().slice(0, 8);
  const runId = `week-20261123-${suffix.slice(0, 4).replace(/[^0-9a-f]/g, "a")}`;
  const runMailbox = `m-${suffix}@localhost`;
  const delegate: SimPersona = {
    key: "delegate-a",
    displayName: "Dorota Test",
    address: `d-${suffix}@localhost`,
    group: "delegate",
    lang: "pl",
    voice: "v",
    signature: "",
  };
  const other: SimPersona = { ...delegate, key: "delegate-b", address: `e-${suffix}@localhost`, lang: "en" };
  const slots = new Map<string, Slot>([
    ["w-1-001", slotOf("w-1-001", { persona: "boss", delegateBehaviour: "done", expectedDelegate: delegate.key })],
    [
      "w-1-002",
      slotOf("w-1-002", { persona: "boss", delegateBehaviour: "out_of_office", expectedDelegate: delegate.key }),
    ],
    ["w-1-003", slotOf("w-1-003", { persona: "boss", delegateBehaviour: "late", expectedDelegate: delegate.key })],
    [
      "w-1-004",
      slotOf("w-1-004", { persona: "boss", delegateBehaviour: "other_address", expectedDelegate: delegate.key }),
    ],
    ["w-1-005", slotOf("w-1-005", { persona: "boss", category: "info" })],
    ["w-1-006", slotOf("w-1-006", { persona: delegate.key })],
    ["w-1-007", slotOf("w-1-007", { persona: "boss", delegateBehaviour: "done", expectedDelegate: other.key })],
    ["w-1-008", slotOf("w-1-008", { persona: "boss", delegateBehaviour: "silent", expectedDelegate: delegate.key })],
  ]);
  const corpus = { scenario: { personas: [delegate, other] }, slots } as unknown as LabCorpus;

  const allowed = new Set([
    delegate.address,
    other.address,
    otherAddressOf(delegate.address),
    otherAddressOf(other.address),
    runMailbox,
  ]);
  const mail = createFakeLabMailClient({ allowedAddresses: allowed });
  const clock = { now: MON_09 };
  const state = createLabState(dir, () => clock.now);
  const plan = { runId, mode: "week", items: [] } as unknown as LiveRunPlan;
  expect(state.startRun({ plan, org: "lab", capUsd: 5 })).toBe("ok");
  state.writeOrgs({ lab: { orgId: randomUUID(), mailboxId: randomUUID(), address: runMailbox, chatId: 1 } });

  return {
    runId,
    runMailbox,
    delegate,
    other,
    mail,
    state,
    clock,
    deps: { state, mail, corpus, now: () => clock.now, allowedAddresses: allowed },
    events: () => state.events(runId),
    labId: (slotId) => `<${slotId}.${runId}@kordelan.test>`,
    sendToDelegate(input) {
      const raw = renderSeedMessage({
        messageId: input.id,
        from: `Wiktor <${input.from ?? runMailbox}>`,
        to: [delegate.address],
        subject: input.subject ?? `Zadanie ${SUBJECT_CANARY}`,
        date: input.date,
        text: BODY_CANARY,
        references: input.references,
        inReplyTo: input.references.at(-1),
        headers: input.headers,
      });
      mail.deliver(delegate.address, INBOX, raw);
    },
  };
}

const tick = (world: World): Promise<BotTickResult> => runDelegateBotsTick(world.deps, world.runId);

// The first tick of a run only sets the cursor: mail that is already there is never read.
async function startBots(world: World): Promise<void> {
  const first = await tick(world);
  expect(first).toEqual({ planned: 0, sent: 0, unmapped: 0, unexpected: 0, failed: 0 });
}

const replyIdOf = (key: string, address: string): string =>
  `<r.${createHash("sha256").update(key).digest("hex").slice(0, 12)}@${address.slice(address.lastIndexOf("@") + 1)}>`;

const plannedOf = (events: LabEvent[]) => events.filter((event) => event.t === "bot_planned");
const codesOf = (events: LabEvent[]) => events.filter((event) => event.t === "skip").map((event) => event.code);

async function runMailboxMessages(world: World): Promise<string[]> {
  return (await world.mail.fetchSince(world.runMailbox, INBOX, 0)).map((message) => message.raw);
}

describe("delegate bots", () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
  });

  test("7: other_address answers from the private address of the delegate", async () => {
    await startBots(world);
    const received = "<srv-7@localhost>";
    world.sendToDelegate({ id: received, references: [world.labId("w-1-004")], date: MON_10 });
    await tick(world);
    world.clock.now = FAR;
    await tick(world);
    const [reply] = await runMailboxMessages(world);
    expect(reply).toContain(`<${otherAddressOf(world.delegate.address)}>`);
    expect(reply).not.toContain(`<${world.delegate.address}>`);
    expect(reply).toContain(`Message-ID: ${replyIdOf(`${received}:done`, otherAddressOf(world.delegate.address))}`);
  });

  test("8: out_of_office answers a delegation and a reminder with Auto-Submitted and never with done", async () => {
    await startBots(world);
    const first = "<srv-8a@localhost>";
    const second = "<srv-8b@localhost>";
    world.sendToDelegate({ id: first, references: [world.labId("w-1-002")], date: MON_10 });
    world.sendToDelegate({
      id: second,
      references: [world.labId("w-1-002"), first],
      date: WED_NOON,
      subject: `Przypomnienie ${SUBJECT_CANARY}`,
    });
    world.clock.now = FAR;
    const result = await tick(world);
    expect(result).toMatchObject({ planned: 2, sent: 2 });
    const replies = await runMailboxMessages(world);
    expect(replies).toHaveLength(2);
    for (const reply of replies) {
      expect(reply).toContain("Auto-Submitted: auto-replied");
      expect(reply).toContain("Jestem poza biurem do ");
      expect(reply).not.toContain("Zrobione");
    }
    expect(replies.join("\n")).toContain("do 30.11.2026."); // MON_10 + 7 days
    expect(replies.join("\n")).toContain("do 02.12.2026."); // WED_NOON + 7 days
    expect(plannedOf(world.events()).map((event) => event.key)).toEqual([
      `${first}:auto_reply`,
      `${second}:auto_reply`,
    ]);
  });

  test("late: nothing for the delegation, one done for the first reminder, nothing for the second", async () => {
    await startBots(world);
    world.clock.now = FAR;
    const delegation = "<srv-l1@localhost>";
    world.sendToDelegate({ id: delegation, references: [world.labId("w-1-003")], date: MON_10 });
    expect(await tick(world)).toMatchObject({ planned: 0, sent: 0 });
    const reminder = "<srv-l2@localhost>";
    world.sendToDelegate({ id: reminder, references: [world.labId("w-1-003"), delegation], date: WED_NOON });
    expect(await tick(world)).toMatchObject({ planned: 1, sent: 1 });
    const again = "<srv-l3@localhost>";
    world.sendToDelegate({
      id: again,
      references: [world.labId("w-1-003"), delegation, reminder],
      date: new Date("2026-11-28T11:00:00.000Z"),
    });
    expect(await tick(world)).toMatchObject({ planned: 0, sent: 0 });
    expect(await runMailboxMessages(world)).toHaveLength(1);
    expect(plannedOf(world.events()).map((event) => event.key)).toEqual([`${reminder}:done`]);
  });

  test("10: no lab id, a slot of category info, a reply to the delegate's own mail, another run's id, a foreign slot → no reply", async () => {
    await startBots(world);
    world.clock.now = FAR;
    world.sendToDelegate({ id: "<srv-10a@localhost>", references: [], date: MON_10 });
    world.sendToDelegate({ id: "<srv-10b@localhost>", references: [world.labId("w-1-005")], date: MON_10 });
    world.sendToDelegate({ id: "<srv-10c@localhost>", references: [world.labId("w-1-006")], date: MON_10 });
    world.sendToDelegate({
      id: "<srv-10d@localhost>",
      references: ["<w-1-001.week-20261123-ffff@kordelan.test>"],
      date: MON_10,
    });
    world.sendToDelegate({ id: "<srv-10e@localhost>", references: [world.labId("w-1-007")], date: MON_10 });
    world.sendToDelegate({ id: "<srv-10f@localhost>", references: [world.labId("w-9-999")], date: MON_10 });
    // A mail from a bot address (the other_address alias) is never read.
    world.sendToDelegate({
      id: "<srv-10g@localhost>",
      references: [world.labId("w-1-001")],
      date: MON_10,
      from: otherAddressOf(world.delegate.address),
    });

    // A mail from another delegate's own address (not the alias) is a bot mail too: no event, nothing planned.
    world.sendToDelegate({
      id: "<srv-10h@localhost>",
      references: [world.labId("w-1-001")],
      date: MON_10,
      from: world.other.address,
    });

    const result = await tick(world);
    expect(result).toMatchObject({ planned: 0, sent: 0, unmapped: 2, unexpected: 2 });
    expect(codesOf(world.events())).toEqual([
      "unmapped",
      "unexpected_delegation",
      "reply_to_own_mail",
      "unexpected_delegation",
      "unmapped",
    ]);
    expect(await runMailboxMessages(world)).toHaveLength(0);
    expect(plannedOf(world.events())).toHaveLength(0);
  });

  test("an automatic mail (Auto-Submitted other than no) gets no reply; Auto-Submitted: no does", async () => {
    await startBots(world);
    world.clock.now = FAR;
    world.sendToDelegate({
      id: "<srv-auto@localhost>",
      references: [world.labId("w-1-001")],
      date: MON_10,
      headers: { "Auto-Submitted": "auto-generated" },
    });
    world.sendToDelegate({
      id: "<srv-no@localhost>",
      references: [world.labId("w-1-001")],
      date: MON_10,
      headers: { "Auto-Submitted": "no" },
    });
    expect(await tick(world)).toMatchObject({ planned: 1, sent: 1 });
    expect(codesOf(world.events())).toEqual(["auto_submitted"]);
    expect(plannedOf(world.events()).map((event) => event.key)).toEqual(["<srv-no@localhost>:done"]);
  });

  describe("failed sends", () => {
    test("the fifth failed send ends the reply with skip send_failed; the next ticks stay quiet", async () => {
      await startBots(world);
      world.sendToDelegate({ id: "<srv-e1@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
      await tick(world);
      world.clock.now = FAR;
      for (let attempt = 0; attempt < MAX_ERRORS_PER_REPLY; attempt += 1) {
        world.mail.failNext("smtpSend", new LabMailError("smtp_failed"));
      }
      for (let attempt = 1; attempt <= MAX_ERRORS_PER_REPLY; attempt += 1) {
        expect(await tick(world)).toMatchObject({ sent: 0, failed: 1 });
        expect(world.events().filter((event) => event.t === "bot_error")).toHaveLength(attempt);
      }
      expect(world.events().filter((event) => event.t === "bot_error")).toEqual(
        Array.from({ length: MAX_ERRORS_PER_REPLY }, () =>
          expect.objectContaining({ key: "<srv-e1@localhost>:done", code: "smtp_failed" })
        )
      );
      expect(world.events().at(-1)).toMatchObject({ t: "skip", code: "send_failed", ref: "<srv-e1@localhost>:done" });
      const events = world.events().length;
      expect(await tick(world)).toMatchObject({ sent: 0, failed: 0 });
      expect(world.events()).toHaveLength(events);
      expect(world.mail.calls.smtpSend).toBe(MAX_ERRORS_PER_REPLY);
      expect(await runMailboxMessages(world)).toHaveLength(0);
    });
  });
});
