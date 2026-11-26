import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { toLabMessage, type CaseText, type LiveRunPlan, type Slot, MINUTE_MS } from "@ea/core";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ImapFlow } from "imapflow";

import {
  createLabMailClient,
  createLabState,
  LAB_MAIL_PASSWORD,
  labAddresses,
  loadLabCorpus,
  LabMailError,
  runInjectorTick,
  type InjectorDeps,
  type LabCorpus,
  type LabMailClient,
  type LabState,
} from "../../src/modules/lab";
import { renderLabMessage } from "../../src/modules/lab/message";

// Needs the local GreenMail (bun run dev:up). Auth is off: any password logs in. The fixture holds 5 slots, not the
// real corpus; each test uses its own mailbox address and its own state directory.
const host = process.env.TEST_IMAP_HOST ?? "127.0.0.1";
const imapPort = Number(process.env.TEST_IMAP_PORT ?? "3143");
const smtpPort = Number(process.env.TEST_SMTP_PORT ?? "3025");
const ROOT = resolve(import.meta.dir, "../../../../evals/sim");
const T0 = new Date("2026-11-23T08:00:00.000Z");
const minutes = (count: number): Date => new Date(T0.getTime() + count * MINUTE_MS);
const RUN = "day-20261123-0001";

let base: LabCorpus;
beforeAll(async () => {
  base = await loadLabCorpus(ROOT, "lab-01");
});

interface Fixture {
  address: string;
  corpus: LabCorpus;
  plan: LiveRunPlan;
  slotIds: string[];
}

function slotAt(template: Slot, id: string, over: Partial<Slot>): Slot {
  return { ...template, id, hardCases: [], headers: {}, attachments: [], thread: [], ...over };
}

// 5 slots: root 1 (to the executive and a second persona), root 2, a reply to root 1, a `sent` slot, a later slot.
function fixtureOf(suffix: string, extraSlots = 0): Fixture {
  const personas = base.scenario.personas.map((persona, index) => ({
    ...persona,
    address: `p${index}-${suffix}@lab.test`,
  }));
  const scenario = { ...base.scenario, personas };
  const [a, b, c, d] = personas.map((persona) => persona.key) as [string, string, string, string];
  const exec = scenario.executive.key;
  const template = [...base.slots.values()].find(
    (slot) =>
      slot.direction === "in" &&
      slot.parentId === undefined &&
      slot.style.format === "plain" &&
      !slot.hardCases.includes("html_only")
  ) as Slot;
  const at = (offset: number): string => minutes(offset).toISOString();
  const list: { slot: Slot; at: string }[] = [
    { slot: slotAt(template, "w-1-001", { persona: a, to: [exec, d], cc: [c] }), at: at(0) },
    { slot: slotAt(template, "w-1-002", { persona: b, to: [exec] }), at: at(1) },
    { slot: slotAt(template, "w-1-003", { persona: c, to: [exec], parentId: "w-1-001" }), at: at(2) },
    { slot: slotAt(template, "w-1-004", { persona: exec, direction: "sent", to: [a] }), at: at(3) },
    { slot: slotAt(template, "w-1-005", { persona: d, to: [exec] }), at: at(10) },
  ];
  for (let index = 0; index < extraSlots; index += 1) {
    list.push({
      slot: slotAt(template, `w-2-${String(index).padStart(3, "0")}`, { persona: a, to: [exec] }),
      at: at(20),
    });
  }
  const texts = new Map<string, CaseText>(
    list.map(({ slot }) => [
      slot.id,
      { id: slot.id, subject: `Subject ${slot.id}`, body: `Body of ${slot.id}`, thread: [] },
    ])
  );
  const corpus: LabCorpus = {
    scenario,
    manifest: base.manifest,
    slots: new Map(list.map(({ slot }) => [slot.id, slot])),
    texts,
    parentsOf: (slotId) => {
      const parentId = list.find(({ slot }) => slot.id === slotId)?.slot.parentId;
      const root = list.find(({ slot }) => slot.id === parentId)?.slot;
      return root === undefined ? [] : [root];
    },
  };
  const plan: LiveRunPlan = {
    runId: RUN,
    mode: "day",
    startDate: "2026-11-23",
    offsetDays: 0,
    scenarioDays: [1],
    items: list.map(({ slot, at: when }) => ({ slotId: slot.id, at: when })),
    endsAt: at(60 * 24),
    tailEndsAt: at(60 * 48),
    deadlines: [],
  };
  return { address: `u-${suffix}@localhost`, corpus, plan, slotIds: list.map(({ slot }) => slot.id) };
}

// An in-memory mail client: delivered raw texts by slot, failures by predicate.
function fakeMail(failWhen: (raw: string) => boolean = () => false) {
  const delivered: string[] = [];
  const calls = { smtp: 0, append: 0, search: 0 };
  const client: LabMailClient = {
    async smtpSend({ raw }) {
      calls.smtp += 1;
      if (failWhen(raw)) throw new LabMailError("smtp_failed", { code: "ECONNREFUSED" });
      delivered.push(raw);
    },
    async appendSent(_mailbox, raw) {
      calls.append += 1;
      delivered.push(raw);
    },
    async hasMessageId(_mailbox, messageId) {
      calls.search += 1;
      return delivered.some((raw) => raw.includes(`Message-ID: ${messageId}`));
    },
    async fetchSince() {
      return [];
    },
    async newestUid() {
      return 0;
    },
  };
  return { client, delivered, calls };
}

async function withImap<T>(address: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host,
    port: imapPort,
    secure: false,
    doSTARTTLS: false,
    auth: { user: address, pass: "x" },
    logger: false,
  });
  client.on("error", () => undefined);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// The injector sends from the scenario addresses to the run mailbox: the guard list is `labAddresses` plus that mailbox.
const clientFor = (corpus: LabCorpus, runMailbox: string): LabMailClient =>
  createLabMailClient({
    host,
    imapPort,
    smtpPort,
    password: LAB_MAIL_PASSWORD,
    allowedAddresses: new Set([...labAddresses(corpus), runMailbox]),
  });
// Reads only: it sends nothing, so its list of addresses is empty.
const readClient = createLabMailClient({
  host,
  imapPort,
  smtpPort,
  password: LAB_MAIL_PASSWORD,
  allowedAddresses: new Set(),
});

const mailsIn = (address: string, folder: string) => readClient.fetchSince(address, folder, 0);

async function allFolders(address: string): Promise<Record<string, number>> {
  const names = await withImap(address, async (client) => (await client.list()).map((entry) => entry.path));
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (await mailsIn(address, name)).length;
  return counts;
}

describe("lab injector (stage 07)", () => {
  let dir = "";
  let clock = T0;
  let fixture: Fixture;
  let state: LabState;
  let real: LabMailClient;

  const open = (path: string): LabState => createLabState(path, () => clock);
  function setup(extraSlots = 0): void {
    fixture = fixtureOf(randomUUID().slice(0, 8), extraSlots);
    real = clientFor(fixture.corpus, fixture.address);
    state = open(dir);
    state.writeOrgs({ lab: { orgId: randomUUID(), mailboxId: randomUUID(), address: fixture.address, chatId: 1 } });
    expect(state.startRun({ plan: fixture.plan, org: "lab", capUsd: 5 })).toBe("ok");
  }
  const deps = (mail: LabMailClient, spend = 0): InjectorDeps => ({
    state,
    mail,
    spendUsd: async () => spend,
    now: () => clock,
    corpus: fixture.corpus,
  });
  const messageOf = (slotId: string) => {
    const slot = fixture.corpus.slots.get(slotId) as Slot;
    return toLabMessage({
      slot,
      text: fixture.corpus.texts.get(slotId) as CaseText,
      scenario: fixture.corpus.scenario,
      plan: fixture.plan,
      mailbox: fixture.address,
      parents: fixture.corpus.parentsOf(slotId),
    });
  };
  const eventsOf = (type: string) => state.events(RUN).filter((event) => event.t === type);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "f113-s07-"));
    clock = T0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("1: the first four slots are delivered: 3 in INBOX, 1 in Sent with \\Seen; the later slot waits", async () => {
    setup();
    clock = minutes(4);
    const tick = await runInjectorTick(deps(real), RUN);
    // Slots 1 and 2 are 240 s and 180 s late; slots 3 and 4 are within the 120 s limit.
    expect(tick).toEqual({ injected: 4, late: 2, skipped: 0 });
    const inbox = await mailsIn(fixture.address, "INBOX");
    expect(inbox).toHaveLength(3);
    expect(inbox.map((mail) => mail.raw).join("\n")).not.toContain("Body of w-1-005");
    const sent = await mailsIn(fixture.address, "Sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.raw).toContain(messageOf("w-1-004").messageId);
    const flags = await withImap(fixture.address, async (client) => {
      const lock = await client.getMailboxLock("Sent");
      try {
        return (await client.fetchOne("1", { flags: true })) as { flags: Set<string> };
      } finally {
        lock.release();
      }
    });
    expect(flags.flags.has("\\Seen")).toBe(true);
    // The other `to` persona and the `cc` persona got no copy.
    for (const index of [2, 3]) {
      const address = fixture.corpus.scenario.personas[index]?.address as string;
      expect((await allFolders(address)).INBOX ?? 0).toBe(0);
    }
    // Events hold ids and counts, never the text of a mail.
    const log = JSON.stringify(state.events(RUN));
    expect(log).not.toContain("Subject w-1-001");
    expect(log).not.toContain("Body of");
    expect(eventsOf("inject_done")).toHaveLength(4);
    expect(eventsOf("inject_intent")).toHaveLength(4);
  });

  test("2: the reply in INBOX has In-Reply-To = the lab Message-ID of root 1, and References with it", async () => {
    setup();
    clock = minutes(4);
    await runInjectorTick(deps(real), RUN);
    const rootId = messageOf("w-1-001").messageId;
    const reply = (await mailsIn(fixture.address, "INBOX")).find((mail) =>
      mail.raw.includes(messageOf("w-1-003").messageId)
    );
    expect(reply?.raw).toMatch(new RegExp(`^In-Reply-To: ${rootId.replace(/[.$]/g, "\\$&")}\\s*$`, "m"));
    expect(reply?.raw).toContain(`References: ${rootId}`);
  });

  test("3: a crash after delivery: intent and mail are there, no done: the tick writes done and sends no second mail", async () => {
    setup();
    clock = minutes(1);
    const message = messageOf("w-1-001");
    state.append(RUN, { t: "inject_intent", slotId: "w-1-001", messageId: message.messageId });
    await real.smtpSend({ envelopeFrom: message.from.address, to: fixture.address, raw: renderLabMessage(message) });
    const tick = await runInjectorTick(deps(real), RUN);
    expect(eventsOf("inject_done").map((event) => (event as { slotId: string }).slotId)).toContain("w-1-001");
    expect(tick.injected).toBe(2);
    const copies = (await mailsIn(fixture.address, "INBOX")).filter((mail) => mail.raw.includes(message.messageId));
    expect(copies).toHaveLength(1);
  });

  test("3b: the delivered mail was moved to another folder before the resume: no second mail in any folder", async () => {
    setup();
    clock = minutes(1);
    const message = messageOf("w-1-001");
    state.append(RUN, { t: "inject_intent", slotId: "w-1-001", messageId: message.messageId });
    await real.smtpSend({ envelopeFrom: message.from.address, to: fixture.address, raw: renderLabMessage(message) });
    await withImap(fixture.address, async (client) => {
      await client.mailboxCreate("Newsletters");
      const lock = await client.getMailboxLock("INBOX");
      try {
        await client.messageMove("1:*", "Newsletters");
      } finally {
        lock.release();
      }
    });
    expect((await allFolders(fixture.address)).INBOX).toBe(0);
    await runInjectorTick(deps(real), RUN);
    expect(eventsOf("inject_done").map((event) => (event as { slotId: string }).slotId)).toContain("w-1-001");
    let copies = 0;
    for (const folder of Object.keys(await allFolders(fixture.address))) {
      copies += (await mailsIn(fixture.address, folder)).filter((mail) => mail.raw.includes(message.messageId)).length;
    }
    expect(copies).toBe(1);
  });

  test("4: an intent with no delivery: the tick sends the mail once; a second tick sends nothing more", async () => {
    setup();
    clock = minutes(1);
    const message = messageOf("w-1-001");
    state.append(RUN, { t: "inject_intent", slotId: "w-1-001", messageId: message.messageId });
    await runInjectorTick(deps(real), RUN);
    await runInjectorTick(deps(real), RUN);
    const copies = (await mailsIn(fixture.address, "INBOX")).filter((mail) => mail.raw.includes(message.messageId));
    expect(copies).toHaveLength(1);
    expect(
      eventsOf("inject_intent").filter((event) => (event as { slotId: string }).slotId === "w-1-001")
    ).toHaveLength(1);
    expect(eventsOf("inject_done")).toHaveLength(2);
  });

  test("5: spend at the cap: nothing is sent, the tick says budget and writes no stopped event", async () => {
    setup();
    clock = minutes(4);
    const mail = fakeMail();
    const tick = await runInjectorTick(deps(mail.client, 5), RUN);
    expect(tick).toEqual({ injected: 0, late: 0, skipped: 0, stopped: "budget" });
    expect(mail.calls.smtp).toBe(0);
    expect(state.events(RUN)).toEqual([]);
    expect(eventsOf("stopped")).toHaveLength(0);
    // Below the cap the same clock sends.
    expect((await runInjectorTick(deps(mail.client, 4.99), RUN)).injected).toBe(4);
  });

  test("6: a slot 10 minutes late has lateBySec 600; a slot under 2 minutes late has none", async () => {
    setup();
    clock = minutes(10);
    const mail = fakeMail();
    const tick = await runInjectorTick(deps(mail.client), RUN);
    const done = (id: string) =>
      eventsOf("inject_done").find((event) => (event as { slotId: string }).slotId === id) as { lateBySec?: number };
    expect(done("w-1-001").lateBySec).toBe(600);
    expect(done("w-1-005").lateBySec).toBeUndefined();
    expect(tick.late).toBe(4);
    expect(tick.injected).toBe(5);
  });

  test("7: 25 due items: 20 in the first tick, in plan order, 5 in the second", async () => {
    setup(20);
    clock = minutes(30);
    const mail = fakeMail();
    const first = await runInjectorTick(deps(mail.client), RUN);
    expect(first.injected).toBe(20);
    const doneIds = () => eventsOf("inject_done").map((event) => (event as { slotId: string }).slotId);
    expect(doneIds()).toEqual(fixture.plan.items.slice(0, 20).map((item) => item.slotId));
    const second = await runInjectorTick(deps(mail.client), RUN);
    expect(second.injected).toBe(5);
    expect(doneIds()).toHaveLength(25);
    expect(new Set(doneIds()).size).toBe(25);
  });

  test("8: SMTP fails for one slot: 5 inject_error, then one skip; later ticks add nothing for it; the next slot goes", async () => {
    setup();
    clock = minutes(2);
    const failId = messageOf("w-1-001").messageId;
    const mail = fakeMail((raw) => raw.includes(`Message-ID: ${failId}`));
    for (let tick = 0; tick < 7; tick += 1) await runInjectorTick(deps(mail.client), RUN);
    const forSlot = state
      .events(RUN)
      .filter(
        (event) => ("slotId" in event && event.slotId === "w-1-001") || ("ref" in event && event.ref === "w-1-001")
      );
    expect(forSlot.map((event) => event.t)).toEqual(["inject_intent", ...Array(5).fill("inject_error"), "skip"]);
    expect(
      forSlot
        .filter((event) => event.t === "inject_error")
        .every((event) => (event as { code: string }).code === "smtp_failed")
    ).toBe(true);
    expect(eventsOf("skip")).toEqual([expect.objectContaining({ code: "smtp_failed", ref: "w-1-001" })]);
    expect(eventsOf("inject_done").map((event) => (event as { slotId: string }).slotId)).toEqual([
      "w-1-002",
      "w-1-003",
    ]);
    // A skipped parent still gives its Message-ID to its reply.
    expect(mail.delivered.find((raw) => raw.includes(messageOf("w-1-003").messageId))).toContain(
      `In-Reply-To: ${failId}`
    );
    // The skip is final: slotsToInject never offers the slot again, and the smtp call count stops at 5 + 2.
    expect(mail.calls.smtp).toBe(5 + 2);
  });

  test("8b: 3 errors, a restart, 2 more errors: the fifth error skips the slot (the count comes from the events)", async () => {
    setup();
    clock = minutes(2);
    const failId = messageOf("w-1-001").messageId;
    const mail = fakeMail((raw) => raw.includes(`Message-ID: ${failId}`));
    for (let tick = 0; tick < 3; tick += 1) await runInjectorTick(deps(mail.client), RUN);
    expect(eventsOf("skip")).toHaveLength(0);
    state = open(dir);
    await runInjectorTick(deps(mail.client), RUN);
    expect(eventsOf("skip")).toHaveLength(0);
    await runInjectorTick(deps(mail.client), RUN);
    expect(eventsOf("inject_error")).toHaveLength(5);
    expect(eventsOf("skip")).toHaveLength(1);
  });

  test("8c: a crash between the fifth error and its skip: the next tick writes the skip and sends nothing", async () => {
    setup();
    clock = minutes(2);
    state.append(RUN, { t: "inject_intent", slotId: "w-1-001", messageId: messageOf("w-1-001").messageId });
    for (let count = 0; count < 5; count += 1)
      state.append(RUN, { t: "inject_error", slotId: "w-1-001", code: "smtp_failed" });
    const mail = fakeMail();
    const tick = await runInjectorTick(deps(mail.client), RUN);
    expect(tick.skipped).toBe(1);
    expect(eventsOf("skip")).toEqual([expect.objectContaining({ ref: "w-1-001", code: "smtp_failed" })]);
    expect(mail.delivered.some((raw) => raw.includes(`Message-ID: ${messageOf("w-1-001").messageId}`))).toBe(false);
  });

  test("a stopped run gets nothing", async () => {
    setup();
    clock = minutes(4);
    state.stopRun(RUN, "operator");
    const mail = fakeMail();
    expect(await runInjectorTick(deps(mail.client), RUN)).toEqual({ injected: 0, late: 0, skipped: 0 });
    expect(mail.calls.smtp).toBe(0);
  });

  test("9: with two seeded orgs the run on `demo` delivers to the demo mailbox and nothing to the lab mailbox", async () => {
    fixture = fixtureOf(randomUUID().slice(0, 8));
    real = clientFor(fixture.corpus, fixture.address);
    const labAddress = `lab-${randomUUID().slice(0, 8)}@localhost`;
    state = open(dir);
    state.writeOrgs({
      // `lab` comes first in the file: a read of the first org instead of the run org would deliver there.
      lab: { orgId: randomUUID(), mailboxId: randomUUID(), address: labAddress, chatId: 1 },
      demo: { orgId: randomUUID(), mailboxId: randomUUID(), address: fixture.address, chatId: 2 },
    });
    expect(state.startRun({ plan: fixture.plan, org: "demo", capUsd: 5 })).toBe("ok");
    clock = minutes(4);
    expect((await runInjectorTick(deps(real), RUN)).injected).toBe(4);
    const labFolders = await allFolders(labAddress);
    expect(Object.values(labFolders).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect((await allFolders(fixture.address)).INBOX).toBe(3);
  });

  test("a client for a host that is not loopback is refused before any connection", () => {
    for (const badHost of ["mail.example.com", "10.0.0.5", "greenmail"]) {
      let caught: unknown;
      try {
        createLabMailClient({
          host: badHost,
          imapPort,
          smtpPort,
          password: LAB_MAIL_PASSWORD,
          allowedAddresses: new Set(),
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LabMailError);
      expect((caught as LabMailError).code).toBe("host_refused");
      expect((caught as LabMailError).message).toBe("host_refused");
    }
    expect(() =>
      createLabMailClient({
        host: "localhost",
        imapPort,
        smtpPort,
        password: LAB_MAIL_PASSWORD,
        allowedAddresses: new Set(),
      })
    ).not.toThrow();
  });

  test("appendInbox stores a mail in the INBOX with the given internal date; countInbox counts it; another mailbox is refused", async () => {
    const address = `inbox-${randomUUID().slice(0, 8)}@localhost`;
    const client = createLabMailClient({
      host,
      imapPort,
      smtpPort,
      password: LAB_MAIL_PASSWORD,
      allowedAddresses: new Set([address]),
    });
    const raw = `Message-ID: <inbox-1@ea-seed.test>\r\nFrom: a@lab.test\r\nTo: ${address}\r\nSubject: old\r\n\r\nbody\r\n`;
    const internalDate = new Date("2026-11-20T10:00:00.000Z");
    expect(await client.countInbox(address)).toBe(0);
    await client.appendInbox(address, raw, internalDate);
    expect(await client.countInbox(address)).toBe(1);
    const stored = await withImap(address, async (imap) => {
      const lock = await imap.getMailboxLock("INBOX", { readOnly: true });
      try {
        const dates: Date[] = [];
        for await (const message of imap.fetch("1:*", { internalDate: true })) {
          dates.push(new Date(message.internalDate as Date));
        }
        return dates;
      } finally {
        lock.release();
      }
    });
    expect(stored).toEqual([internalDate]);
    const other = `other-${randomUUID().slice(0, 8)}@localhost`;
    await expect(client.appendInbox(other, raw, internalDate)).rejects.toMatchObject({ code: "address_refused" });
    await expect(client.countInbox(other)).rejects.toMatchObject({ code: "address_refused" });
  });

  test("a mail client error holds a code, never the text of the mail", async () => {
    const dead = createLabMailClient({
      host,
      imapPort,
      smtpPort: 1,
      password: LAB_MAIL_PASSWORD,
      allowedAddresses: new Set(["a@lab.test", "b@localhost"]),
    });
    const error = await dead
      .smtpSend({ envelopeFrom: "a@lab.test", to: "b@localhost", raw: "Subject: secret-canary\r\n\r\nsecret-canary" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LabMailError);
    const failure = error as LabMailError;
    expect(failure.code).toBe("smtp_failed");
    expect(failure.message).toBe("smtp_failed");
    expect(JSON.stringify([failure.message, failure.detail])).not.toContain("secret-canary");
    expect(await readClient.fetchSince(`nobody-${randomUUID().slice(0, 8)}@localhost`, "Nope", 0)).toEqual([]);
  });
});
