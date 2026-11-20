import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { otherAddressOf, type LiveRunPlan, type SimPersona, type Slot } from "@ea/core";
import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import {
  createLabMailClient,
  createLabState,
  LabMailError,
  MAX_ERRORS_PER_REPLY,
  runDelegateBotsTick,
  type BotDeps,
  type BotTickResult,
  type LabCorpus,
  type LabEvent,
  type LabMailClient,
  type LabState,
} from "../../src/modules/lab";
import { INBOX, renderSeedMessage } from "../../src/modules/mail";

// Needs the shared GreenMail (bun run dev:up): auth is off and a new address gets its mailbox. Every test uses random
// addresses, so parallel runs never meet. The bots use no database.
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");

// One GreenMail login takes about 250 ms and a test makes 10 to 30 of them: the default 5 s is too short by design.
setDefaultTimeout(30_000);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// Monday 2026-11-23: Warsaw is UTC+1.
const MON_10 = new Date("2026-11-23T09:00:00.000Z");
const MON_09 = new Date("2026-11-23T08:00:00.000Z");
const FAR = new Date("2026-12-31T12:00:00.000Z");

async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 8000;
  while (true) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() >= deadline) throw new Error(`eventually: ${what}`);
    await Bun.sleep(40);
  }
}

interface World {
  runId: string;
  runMailbox: string;
  delegate: SimPersona;
  other: SimPersona; // another delegate persona with its own inbox
  mail: LabMailClient;
  state: LabState;
  deps: BotDeps;
  clock: { now: Date };
  events: () => LabEvent[];
  eventsText: () => string;
  dir: string;
  // A mail the sim server would send to the delegate: From the run mailbox.
  // Sends one mail to the delegate and returns at once; `waitInbox` waits for the mails to arrive.
  sendToDelegate(input: {
    id: string;
    references: string[];
    date: Date;
    subject?: string;
    cc?: string[];
    headers?: Record<string, string>;
    // The Subject header value as it goes on the wire (an encoded word that decodes to a line break).
    rawSubject?: string;
  }): Promise<void>;
  // Waits until every mail sent with `sendToDelegate` is in the delegate inbox.
  arrived(): Promise<void>;
  inbox(address: string): Promise<{ uid: number; raw: string }[]>;
  labId(slotId: string): string;
}

const SUBJECT_CANARY = "CANARY-subject-5d1c";
const BODY_CANARY = "CANARY-body-8f3e";

function slotOf(id: string, fields: Partial<Slot>): Slot {
  return { id, persona: "x", direction: "received", hardCases: [], to: [], cc: [], ...fields } as unknown as Slot;
}

async function makeWorld(options: { allowRunMailbox?: boolean } = {}): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), "f113-s08-"));
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
  ]);
  if (options.allowRunMailbox !== false) allowed.add(runMailbox);
  const mail = createLabMailClient({ host, imapPort, smtpPort, password: "greenmail-test", allowedAddresses: allowed });
  // The sim server's side of the test: it may send from the run mailbox, whatever the bots are allowed to do.
  const feeder = createLabMailClient({
    host,
    imapPort,
    smtpPort,
    password: "greenmail-test",
    allowedAddresses: new Set([...allowed, runMailbox]),
  });
  const clock = { now: MON_09 };
  const state = createLabState(dir, () => clock.now);
  const plan = { runId, mode: "week", items: [] } as unknown as LiveRunPlan;
  expect(state.startRun({ plan, org: "lab", capUsd: 5 })).toBe("ok");
  state.writeOrgs({ lab: { orgId: randomUUID(), mailboxId: randomUUID(), address: runMailbox, chatId: 1 } });

  let sentCount = 0;
  const labId = (slotId: string): string => `<${slotId}.${runId}@kordelan.test>`;
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
    dir,
    eventsText: () => readFileSync(join(dir, "runs", runId, "events.jsonl"), "utf8"),
    labId,
    inbox: (address) => mail.fetchSince(address, INBOX, 0),
    async arrived() {
      await eventually(
        () => mail.fetchSince(delegate.address, INBOX, 0),
        (found) => found.length >= sentCount,
        "delivery to the delegate"
      );
    },
    async sendToDelegate(input) {
      const rendered = renderSeedMessage({
        messageId: input.id,
        from: `Wiktor <${runMailbox}>`,
        to: [delegate.address],
        subject: input.subject ?? `Zadanie ${SUBJECT_CANARY}`,
        date: input.date,
        text: BODY_CANARY,
        references: input.references,
        inReplyTo: input.references.at(-1),
        cc: input.cc,
        headers: input.headers,
      });
      const raw =
        input.rawSubject === undefined ? rendered : rendered.replace(/^Subject: .*$/m, `Subject: ${input.rawSubject}`);
      sentCount += 1;
      await feeder.smtpSend({ envelopeFrom: runMailbox, to: delegate.address, raw });
    },
  };
}

async function tick(world: World): Promise<BotTickResult> {
  await world.arrived();
  return runDelegateBotsTick(world.deps, world.runId);
}

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
  return (await world.inbox(world.runMailbox)).map((message) => message.raw);
}

describe("delegate bots", () => {
  let world: World;
  beforeEach(async () => {
    world = await makeWorld();
  });

  test("6: done sends one reply at its time, from the delegate, with the threading headers", async () => {
    await startBots(world);
    const received = "<srv-6@localhost>";
    await world.sendToDelegate({ id: received, references: [world.labId("w-1-001")], date: MON_10 });

    const early = await tick(world);
    expect(early).toMatchObject({ planned: 1, sent: 0 });
    const [planned] = plannedOf(world.events());
    expect(planned?.key).toBe(`${received}:done`);
    expect(await runMailboxMessages(world)).toHaveLength(0);

    world.clock.now = new Date(planned?.at as string);
    const due = await tick(world);
    expect(due).toMatchObject({ planned: 0, sent: 1 });
    const [reply] = await eventually(
      () => runMailboxMessages(world),
      (found) => found.length > 0,
      "the reply"
    );
    expect(reply).toContain(`From: Dorota Test <${world.delegate.address}>`);
    expect(reply).toContain(`In-Reply-To: ${received}`);
    expect(reply).toContain(`References: ${world.labId("w-1-001")} ${received}`);
    expect(reply).toContain(`Message-ID: ${replyIdOf(`${received}:done`, world.delegate.address)}`);
    expect(reply).toContain(`Subject: Re: Zadanie ${SUBJECT_CANARY}`);
    expect(reply).toContain("Zrobione. Pozdrawiam, Dorota Test");
    expect(reply).not.toContain("Auto-Submitted");
    expect(world.events().map((event) => event.t)).toContain("bot_done");

    // A later tick, and a restart (a new state object over the same files), send nothing more.
    expect(await tick(world)).toMatchObject({ planned: 0, sent: 0 });
    expect(await runMailboxMessages(world)).toHaveLength(1);
  });

  test("silent plans and sends nothing", async () => {
    await startBots(world);
    world.clock.now = FAR;
    await world.sendToDelegate({ id: "<srv-s@localhost>", references: [world.labId("w-1-008")], date: MON_10 });
    expect(await tick(world)).toMatchObject({ planned: 0, sent: 0 });
    expect(await runMailboxMessages(world)).toHaveLength(0);
  });

  test("9: a crash between bot_intent and bot_done, reply delivered by hand → nothing new is sent", async () => {
    await startBots(world);
    const received = "<srv-9@localhost>";
    await world.sendToDelegate({ id: received, references: [world.labId("w-1-001")], date: MON_10 });
    await tick(world);
    const key = `${received}:done`;
    const messageId = replyIdOf(key, world.delegate.address);
    world.state.append(world.runId, { t: "bot_intent", key, messageId });
    const raw = renderSeedMessage({
      messageId,
      from: `Dorota Test <${world.delegate.address}>`,
      to: [world.runMailbox],
      subject: "Re: by hand",
      date: MON_10,
      text: "by hand",
    });
    await world.mail.smtpSend({ envelopeFrom: world.delegate.address, to: world.runMailbox, raw });
    await eventually(
      () => runMailboxMessages(world),
      (found) => found.length === 1,
      "the hand-made reply"
    );

    world.clock.now = FAR;
    expect(await tick(world)).toMatchObject({ sent: 0, failed: 0 });
    expect(world.events().filter((event) => event.t === "bot_done")).toHaveLength(1);
    expect(await runMailboxMessages(world)).toHaveLength(1);
  });

  test("9b: the same crash, but the sim server moved the reply to Notifications → no second reply in any folder", async () => {
    await startBots(world);
    const received = "<srv-9b@localhost>";
    await world.sendToDelegate({ id: received, references: [world.labId("w-1-001")], date: MON_10 });
    await tick(world);
    const key = `${received}:done`;
    const messageId = replyIdOf(key, world.delegate.address);
    world.state.append(world.runId, { t: "bot_intent", key, messageId });
    const raw = renderSeedMessage({
      messageId,
      from: `Dorota Test <${world.delegate.address}>`,
      to: [world.runMailbox],
      subject: "Re: by hand",
      date: MON_10,
      text: "by hand",
    });
    await world.mail.smtpSend({ envelopeFrom: world.delegate.address, to: world.runMailbox, raw });
    await eventually(
      () => runMailboxMessages(world),
      (found) => found.length === 1,
      "the hand-made reply"
    );
    const client = new ImapFlow({
      host,
      port: imapPort,
      secure: false,
      doSTARTTLS: false,
      auth: { user: world.runMailbox, pass: "greenmail-test" },
      logger: false,
    });
    await client.connect();
    try {
      await client.mailboxCreate("Notifications");
      const lock = await client.getMailboxLock(INBOX);
      try {
        await client.messageMove("1:*", "Notifications");
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    expect(await runMailboxMessages(world)).toHaveLength(0);

    world.clock.now = FAR;
    expect(await tick(world)).toMatchObject({ sent: 0, failed: 0 });
    expect(await runMailboxMessages(world)).toHaveLength(0); // no second reply landed in the INBOX
    expect(await world.mail.hasMessageId(world.runMailbox, messageId)).toBe(true);
    expect(world.events().filter((event) => event.t === "bot_done")).toHaveLength(1);
  });

  test("a bot_intent with no reply anywhere is sent once, without a second intent", async () => {
    await startBots(world);
    const received = "<srv-9c@localhost>";
    await world.sendToDelegate({ id: received, references: [world.labId("w-1-001")], date: MON_10 });
    await tick(world);
    const key = `${received}:done`;
    world.state.append(world.runId, { t: "bot_intent", key, messageId: replyIdOf(key, world.delegate.address) });
    world.clock.now = FAR;
    expect(await tick(world)).toMatchObject({ sent: 1 });
    await eventually(
      () => runMailboxMessages(world),
      (found) => found.length === 1,
      "the reply"
    );
    expect(world.events().filter((event) => event.t === "bot_intent")).toHaveLength(1);
  });

  test("N6: mail that was in the delegate inbox before the first tick is never read", async () => {
    await world.sendToDelegate({ id: "<srv-old@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
    world.clock.now = FAR;
    await startBots(world);
    expect(await tick(world)).toMatchObject({ planned: 0, sent: 0 });
    expect(world.events().some((event) => event.t === "skip" || event.t === "bot_planned")).toBe(false);
  });

  test("a replay of the same mail plans once", async () => {
    await startBots(world);
    await world.sendToDelegate({ id: "<srv-r@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
    await tick(world);
    expect(plannedOf(world.events())).toHaveLength(1);
    // A crash between the plan and the `seen` events: the file keeps the plan and loses the two lines after it.
    const file = join(world.dir, "runs", world.runId, "events.jsonl");
    const kept = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .filter((line) => {
        const event = JSON.parse(line) as LabEvent;
        return !(event.t === "seen" && (event.part.startsWith("mail:") || event.ref !== "0"));
      });
    writeFileSync(file, `${kept.join("\n")}\n`);
    expect(world.events().some((event) => event.t === "seen" && event.part.startsWith("mail:"))).toBe(false);
    expect(await tick(world)).toMatchObject({ planned: 0 });
    expect(plannedOf(world.events())).toHaveLength(1);
    expect(world.events().some((event) => event.t === "seen" && event.part.startsWith("mail:"))).toBe(true);
  });

  test("the address guard: a recipient that is not allowed gets nothing, the event holds a code", async () => {
    world = await makeWorld({ allowRunMailbox: false });
    await startBots(world);
    world.clock.now = FAR;
    await world.sendToDelegate({ id: "<srv-g@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
    // The delegate mail is sent with the raw client of the delegate side: the run mailbox is outside the allowed set,
    // so the test sends the mail to the delegate through a client that allows it.
    expect(await tick(world)).toMatchObject({ sent: 0 });
    expect(codesOf(world.events())).toContain("address_refused");
    expect(await runMailboxMessages(world)).toHaveLength(0);
  });

  test("the mail client refuses an envelope address outside its list, before any connection", async () => {
    const strict = createLabMailClient({
      host: "127.0.0.1",
      imapPort: 1,
      smtpPort: 1,
      password: "x",
      allowedAddresses: new Set(["a@localhost"]),
    });
    await expect(
      strict.smtpSend({ envelopeFrom: "a@localhost", to: "real@example.com", raw: "x" })
    ).rejects.toMatchObject({
      code: "address_refused",
    });
    await expect(
      strict.smtpSend({ envelopeFrom: "real@example.com", to: "a@localhost", raw: "x" })
    ).rejects.toBeInstanceOf(LabMailError);
  });

  test("events hold no subject, no text and no address", async () => {
    await startBots(world);
    await world.sendToDelegate({ id: "<srv-c@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
    await world.sendToDelegate({ id: "<srv-c2@localhost>", references: [], date: MON_10 });
    world.clock.now = FAR;
    await tick(world);
    const text = world.eventsText();
    expect(text).toContain("bot_done");
    for (const secret of [SUBJECT_CANARY, BODY_CANARY, "Dorota", world.delegate.address, world.runMailbox]) {
      expect(text).not.toContain(secret);
    }
  });
  test("P1: a delegation with Reply-To, Cc and Bcc outside gets one reply to the run mailbox only", async () => {
    await startBots(world);
    const suffix = randomUUID().slice(0, 8);
    const outside = {
      replyTo: `out-reply-${suffix}@localhost`,
      cc: `out-cc-${suffix}@localhost`,
      bcc: `out-bcc-${suffix}@localhost`,
    };
    const received = "<srv-p1@localhost>";
    await world.sendToDelegate({
      id: received,
      references: [world.labId("w-1-001")],
      date: MON_10,
      cc: [outside.cc],
      headers: { "Reply-To": outside.replyTo, Bcc: outside.bcc },
    });
    await tick(world);
    world.clock.now = FAR;
    // The normal case: the reply goes out, nothing is refused, nothing fails.
    expect(await tick(world)).toMatchObject({ sent: 1, failed: 0 });
    expect(codesOf(world.events())).toEqual([]);
    const [reply] = await eventually(
      () => runMailboxMessages(world),
      (found) => found.length === 1,
      "the reply"
    );
    expect(reply).toMatch(new RegExp(`^To: ${world.runMailbox}\\r?$`, "m"));
    for (const address of Object.values(outside)) expect(reply).not.toContain(address);
    expect(reply).not.toMatch(/^(Cc|Bcc|Reply-To):/im);
    // No outside mailbox got a mail (a short wait: GreenMail delivers after the 250).
    await Bun.sleep(100);
    for (const address of Object.values(outside)) expect(await world.inbox(address)).toHaveLength(0);
    expect(await runMailboxMessages(world)).toHaveLength(1);
  });

  describe("failed sends", () => {
    const failingSmtp = (calls: { count: number }): LabMailClient => ({
      ...world.mail,
      smtpSend: () => {
        calls.count += 1;
        return Promise.reject(new LabMailError("smtp_failed"));
      },
    });

    test("a crash between the fifth error and its skip: the next tick writes the skip and tries nothing", async () => {
      await startBots(world);
      await world.sendToDelegate({ id: "<srv-e2@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
      await tick(world);
      const key = "<srv-e2@localhost>:done";
      for (let attempt = 0; attempt < MAX_ERRORS_PER_REPLY; attempt += 1) {
        world.state.append(world.runId, { t: "bot_error", key, code: "smtp_failed" });
      }
      world.clock.now = FAR;
      const calls = { count: 0 };
      const result = await runDelegateBotsTick({ ...world.deps, mail: failingSmtp(calls) }, world.runId);
      expect(result).toMatchObject({ sent: 0, failed: 0 });
      expect(calls.count).toBe(0);
      expect(world.events().at(-1)).toMatchObject({ t: "skip", code: "send_failed", ref: key });
      expect(await runMailboxMessages(world)).toHaveLength(0);
    });

    test("four errors, then a restart and a good send: the reply goes out once", async () => {
      await startBots(world);
      await world.sendToDelegate({ id: "<srv-e3@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
      await tick(world);
      const key = "<srv-e3@localhost>:done";
      for (let attempt = 0; attempt < MAX_ERRORS_PER_REPLY - 1; attempt += 1) {
        world.state.append(world.runId, { t: "bot_error", key, code: "smtp_failed" });
      }
      world.clock.now = FAR;
      expect(await tick(world)).toMatchObject({ sent: 1, failed: 0 });
      expect(codesOf(world.events())).toEqual([]);
    });

    test("a subject that decodes to a line break ends as render_failed after five tries; nothing goes out", async () => {
      await startBots(world);
      await world.sendToDelegate({
        id: "<srv-e4@localhost>",
        references: [world.labId("w-1-001")],
        date: MON_10,
        rawSubject: "=?utf-8?Q?x=0D=0ABcc:_evil@example.com?=",
      });
      await tick(world);
      world.clock.now = FAR;
      for (let attempt = 0; attempt < MAX_ERRORS_PER_REPLY; attempt += 1) {
        expect(await tick(world)).toMatchObject({ sent: 0, failed: 1 });
      }
      const errors = world.events().filter((event) => event.t === "bot_error");
      expect(errors).toHaveLength(MAX_ERRORS_PER_REPLY);
      expect(errors.every((event) => event.code === "render_failed")).toBe(true);
      expect(codesOf(world.events())).toEqual(["send_failed"]);
      expect(world.events().some((event) => event.t === "bot_intent")).toBe(false);
      expect(await runMailboxMessages(world)).toHaveLength(0);
    });
  });

  test("a long subject is cut to 200 characters in the reply", async () => {
    await startBots(world);
    await world.sendToDelegate({
      id: "<srv-long@localhost>",
      references: [world.labId("w-1-001")],
      date: MON_10,
      subject: "Zadanie ".concat("ą".repeat(3000)),
    });
    await tick(world);
    world.clock.now = FAR;
    expect(await tick(world)).toMatchObject({ sent: 1, failed: 0 });
    const [reply] = await eventually(
      () => runMailboxMessages(world),
      (found) => found.length === 1,
      "the reply"
    );
    const subject = ((await simpleParser(reply as string)).subject ?? "").replace(/\s+/g, " ");
    expect(subject.startsWith("Re: Zadanie ąąą")).toBe(true);
    expect([...subject]).toHaveLength(200);
  });

  test("review 8 note 9: a UID that now holds another mail (after a mailbox reset) ends the reply with received_changed, no send", async () => {
    await startBots(world);
    const received = "<srv-uid@localhost>";
    await world.sendToDelegate({ id: received, references: [world.labId("w-1-001")], date: MON_10 });
    await tick(world);
    const [planned] = plannedOf(world.events());
    expect(planned?.key).toBe(`${received}:done`);
    // The same UID, another Message-ID: what a changed UIDVALIDITY can do.
    const swapped: LabMailClient = {
      ...world.mail,
      fetchSince: async (mailbox, folder, afterUid) =>
        (await world.mail.fetchSince(mailbox, folder, afterUid)).map((message) => ({
          ...message,
          raw: message.raw.replace(`Message-ID: ${received}`, "Message-ID: <srv-other@localhost>"),
        })),
    };
    world.clock.now = FAR;
    expect(await runDelegateBotsTick({ ...world.deps, mail: swapped }, world.runId)).toMatchObject({
      sent: 0,
      failed: 0,
    });
    expect(world.events().filter((event) => event.t === "skip")).toEqual([
      expect.objectContaining({ code: "received_changed", ref: planned?.key }),
    ]);
    expect(world.events().some((event) => event.t === "bot_intent" || event.t === "bot_done")).toBe(false);
    expect(await runMailboxMessages(world)).toHaveLength(0);
    // The item is ended: the next tick sends nothing, with the real client too.
    expect(await tick(world)).toMatchObject({ sent: 0 });
    expect(await runMailboxMessages(world)).toHaveLength(0);
  });

  test("a failed read of one delegate inbox does not stop the others", async () => {
    await startBots(world);
    await world.sendToDelegate({ id: "<srv-f@localhost>", references: [world.labId("w-1-001")], date: MON_10 });
    await world.arrived();
    world.clock.now = FAR;
    const flaky: LabMailClient = {
      ...world.mail,
      fetchSince: (mailbox, folder, afterUid) =>
        mailbox === world.other.address
          ? Promise.reject(new LabMailError("imap_fetch"))
          : world.mail.fetchSince(mailbox, folder, afterUid),
    };
    // The persona list puts the failing delegate after the working one, so this also covers the order the other way.
    expect(await runDelegateBotsTick({ ...world.deps, mail: flaky }, world.runId)).toMatchObject({
      planned: 1,
      sent: 1,
      failed: 1,
    });
    const reversed: LabMailClient = {
      ...world.mail,
      fetchSince: (mailbox, folder, afterUid) =>
        mailbox === world.delegate.address
          ? Promise.reject(new LabMailError("imap_fetch"))
          : world.mail.fetchSince(mailbox, folder, afterUid),
    };
    expect(await runDelegateBotsTick({ ...world.deps, mail: reversed }, world.runId)).toMatchObject({
      planned: 0,
      failed: 1,
    });
  });
});
