import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { labMessageId, planLiveRun, type LiveRunPlan } from "@ea/core";
import { afterAll, afterEach, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { getActionFeedback, noDelegationHooks } from "../../../apps/server/src/modules/actions";
import { createTelegramRuntime } from "../../../apps/server/src/modules/channels";
import {
  createFakeTgClient,
  createLabState,
  loadLabCorpus,
  lookupCard,
  runExecutiveTick,
  type ExecutiveDeps,
  type FakeMessage,
  type FakeTgClient,
  type LabCorpus,
  type LabState,
  type LoggedLabEvent,
} from "../../../apps/server/src/modules/lab";
import { NO_TEST_SENDERS } from "../../../apps/server/src/modules/mail";
import { setOrgFeature } from "../../../apps/server/src/modules/tenancy";
import type { DB } from "../../../apps/server/src/platform/db";
import {
  createOrgWithMailbox,
  insertDraftAndSend,
  insertTriagedWithActions,
  isolateChannels,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
} from "../../../apps/server/test/integration/fixtures";
import { testDb, withRollback } from "../../../apps/server/test/integration/helpers";
import { FAKE_TOKEN, startFakeTelegram } from "../src";

import { timeZoneOutsideQuietHours } from "./setup";

// The executive driver against the real fake Telegram, the server's Telegram runtime and the DB.
// The cards of the approval cases are the real ones (the outbox notices of the runtime). The cards of the digest cases
// are the real `/digest` answer. Cards that only need an id (cases 4, 6, 7, 7b) are built by `botSend` from button data.
const db = testDb();
const SIM_ROOT = resolve(import.meta.dir, "../../../evals/sim");
const HOUR = 3_600_000;
const MINUTE = 60_000;
const WAIT_MS = 10_000;
const DOMAIN = "kordelan.test";

const corpus: LabCorpus = await loadLabCorpus(SIM_ROOT, "lab-01");
const planned = planLiveRun({
  scenario: corpus.scenario,
  slots: [...corpus.slots.values()],
  mode: "day",
  startDate: "2026-11-23",
  runId: "day-20261123-abcd",
});
if ("refused" in planned) throw new Error(planned.refused);
const plan: LiveRunPlan = planned;
const { runId } = plan;
afterAll(async () => {
  await db.destroy();
});

const dirs: string[] = [];
const fakes: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  await Promise.all(fakes.splice(0).map((fake) => fake.stop()));
});

// Slots of lab-01 (checked in `slotOf`): w-1-008 delegation to `asystentka`, w-1-011 urgent, w-1-002 info, w-1-005 spam.
const slotOf = (id: string, category: string) => {
  const slot = corpus.slots.get(id);
  if (slot?.category !== category) throw new Error(`slot ${id} is not ${category}`);
  return slot;
};
const addressOf = (key: string): string => {
  const persona = corpus.scenario.personas.find((candidate) => candidate.key === key);
  if (persona === undefined) throw new Error(`persona ${key}`);
  return persona.address;
};
const labId = (slotId: string, run = runId): string => labMessageId(slotId, run, DOMAIN);

const WRONG_DELEGATE = addressOf("koordynator-sprzedazy");
const RIGHT_DELEGATE = addressOf("asystentka");

async function until(what: string, check: () => Promise<boolean>, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`until: ${what} not true after ${timeoutMs} ms`);
    await Bun.sleep(25);
  }
}

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
  chatId: number;
}

interface World {
  trx: Transaction<DB>;
  fake: ReturnType<typeof startFakeTelegram>;
  client: FakeTgClient;
  a: Org;
  b: Org;
  clock: { at: Date };
  dir: string;
  state: LabState;
  deps: ExecutiveDeps;
  runtime: ReturnType<typeof createTelegramRuntime>;
  // A second state object over the same files and a new driver: what a restart of the lab process does.
  restart(): void;
  tick(): Promise<Awaited<ReturnType<typeof runExecutiveTick>>>;
  events(): LoggedLabEvent[];
  cards(chatId: number): Promise<FakeMessage[]>;
  callbackData(chatId: number): string[];
}

async function withWorld(fn: (world: World) => Promise<void>): Promise<void> {
  await withRollback(db, async (trx) => {
    await pauseOtherMailboxes(trx);
    await isolateChannels(trx);
    const fake = startFakeTelegram();
    fakes.push(fake);
    const client = createFakeTgClient(fake.apiRoot);
    const startedAt = new Date(Date.now() - HOUR);
    const timeZone = timeZoneOutsideQuietHours(new Date());
    const orgs: Org[] = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await createOrgWithMailbox(trx);
      await trx.updateTable("organizations").set({ timezone: timeZone }).where("id", "=", created.orgId).execute();
      await setOrgFeature(
        trx,
        { orgId: created.orgId },
        { flag: "mistake_capture", enabled: true, actor: "cli", now: new Date() }
      );
      const chatId = randomChatId();
      await linkChat(trx, { orgId: created.orgId }, created.userId, chatId, startedAt);
      orgs.push({ ...created, chatId });
    }
    const [a, b] = orgs as [Org, Org];

    const hooks = noDelegationHooks;
    const runtime = createTelegramRuntime({
      db: trx,
      token: FAKE_TOKEN,
      now: () => new Date(),
      startedAt,
      llmDailyCap: 300,
      triageScope: "off",
      actionsScope: { kind: "all" },
      llm: { provider: "gemini", classifierModel: "fake-model" },
      hooks,
      uidplus: async () => true,
      sendScope: { kind: "off" },
      testMail: NO_TEST_SENDERS,
      operatorContact: null,
      syncEveryMin: 2,
      apiRoot: fake.apiRoot,
    });
    try {
      runtime.startPolling();
      // The chat exists in the fake after the first user message; the runtime answers it.
      for (const org of [a, b]) {
        await client.send(org.chatId, "/help");
        await until("help answer", async () =>
          (await client.read(org.chatId)).some((message) => message.from === "bot")
        );
      }

      const dir = mkdtempSync(join(tmpdir(), "f113-s10-exec-"));
      dirs.push(dir);
      const clock = { at: new Date("2026-11-23T08:00:00.000Z") };
      const now = () => clock.at;
      const first = createLabState(dir, now);
      first.writeOrgs({
        lab: { orgId: a.orgId, mailboxId: a.mailboxId, address: "lab@kordelan.test", chatId: a.chatId },
        demo: { orgId: b.orgId, mailboxId: b.mailboxId, address: "demo@kordelan.test", chatId: b.chatId },
      });
      if (first.startRun({ plan, org: "lab", capUsd: 1 }) !== "ok") throw new Error("run did not start");

      const world: World = {
        trx,
        fake,
        client,
        a,
        b,
        clock,
        dir,
        state: first,
        deps: { state: first, tg: client, db: trx, now, corpus },
        runtime,
        restart() {
          world.state = createLabState(dir, now);
          world.deps = { state: world.state, tg: world.deps.tg, db: trx, now, corpus };
        },
        tick: () => runExecutiveTick(world.deps, runId),
        events: () => world.state.events(runId),
        cards: (chatId) => client.read(chatId),
        callbackData: (chatId) => fake.state.callbacks(chatId).map((callback) => callback.data),
      };
      await fn(world);
    } finally {
      await runtime.stop();
    }
  });
}

// A real approval card: a delegation mail of the run with its draft and send, and the notice the runtime sends.
async function approvalCard(
  w: World,
  input: { org?: Org; slotId?: string; messageId?: string; to: string; kind?: "delegation" | "clarification" }
): Promise<{ sendId: string; emailId: string; message: FakeMessage }> {
  const org = input.org ?? w.a;
  const { sendId, emailId } = await insertDraftAndSend(w.trx, { orgId: org.orgId }, org.mailboxId, {
    kind: input.kind ?? "delegation",
    to: input.to,
    messageId: input.messageId ?? labId(input.slotId ?? "w-1-008"),
    createdAt: new Date(),
  });
  await w.runtime.notify();
  let found: FakeMessage | undefined;
  await until(`approval card of ${sendId}`, async () => {
    found = (await w.client.read(org.chatId)).find((message) =>
      message.buttons.flat().some((button) => button.data === `ap:${sendId}`)
    );
    return found !== undefined;
  });
  return { sendId, emailId, message: found as FakeMessage };
}

const sendStatus = async (trx: Transaction<DB>, sendId: string): Promise<string> =>
  (await trx.selectFrom("actions").select("status").where("id", "=", sendId).executeTakeFirstOrThrow()).status;

const kinds = (events: readonly LoggedLabEvent[]): string[] => events.map((event) => event.t);

// A mail with an applied move out of the INBOX and a digest line that carries its Undo button.
async function movedMail(
  w: World,
  slotId: string,
  category: "urgent" | "info" | "spam",
  folder: string,
  org: Org = w.a
) {
  const { emailId } = await insertTriagedWithActions(w.trx, { orgId: org.orgId }, org.mailboxId, {
    category,
    createdAt: new Date(Date.now() - 10 * MINUTE),
    messageId: labId(slotId),
    folder,
    movedAt: new Date(Date.now() - 5 * MINUTE),
    actions: [{ type: "move", status: "applied", payload: { folder }, appliedAt: new Date(Date.now() - 5 * MINUTE) }],
  });
  return emailId;
}

async function digestCard(w: World): Promise<FakeMessage> {
  const before = (await w.client.read(w.a.chatId)).length;
  await w.client.send(w.a.chatId, "/digest");
  let found: FakeMessage | undefined;
  await until("digest answer", async () => {
    const messages = await w.client.read(w.a.chatId);
    found = messages.slice(before).find((message) => message.from === "bot" && message.buttons.flat().length > 0);
    return found !== undefined;
  });
  return found as FakeMessage;
}

test("1: a delegation to the expected delegate gets one ap: press at its time; the action is approved", async () => {
  slotOf("w-1-008", "delegation");
  await withWorld(async (w) => {
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    const { sendId, message } = await approvalCard(w, { to: RIGHT_DELEGATE });

    expect(await w.tick()).toEqual({ planned: 1, pressed: 0, unmapped: 0, noRule: 0 });
    const planned = w.events().find((event) => event.t === "tap_planned");
    expect(planned).toMatchObject({ t: "tap_planned", data: `ap:${sendId}`, messageId: message.messageId });
    // Monday 09:00 in Warsaw: the tap falls 5 to 90 minutes after it.
    const at = Date.parse((planned as { at: string }).at);
    expect(at).toBeGreaterThanOrEqual(Date.parse("2026-11-23T08:05:00Z"));
    expect(at).toBeLessThanOrEqual(Date.parse("2026-11-23T09:30:00Z"));
    expect(w.callbackData(w.a.chatId)).toEqual([]);

    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 1, unmapped: 0, noRule: 0 });
    await until("send approved", async () => (await sendStatus(w.trx, sendId)) === "approved");
    expect(w.callbackData(w.a.chatId)).toEqual([`ap:${sendId}`]);
    expect(kinds(w.events()).filter((type) => type.startsWith("tap_"))).toEqual([
      "tap_planned",
      "tap_intent",
      "tap_done",
    ]);

    // Later ticks press nothing again.
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.callbackData(w.a.chatId)).toEqual([`ap:${sendId}`]);
  });
}, 60_000);

test("2: a delegation to another delegate: ar:, then rw:p: on the same message after the edit, over a restart", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const { sendId, message } = await approvalCard(w, { to: WRONG_DELEGATE });
    await w.tick();
    const planned = w.events().find((event) => event.t === "tap_planned");
    expect(planned).toMatchObject({ data: `ar:${sendId}`, then: "p", messageId: message.messageId });

    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect((await w.tick()).pressed).toBe(1);
    await until("send rejected", async () => (await sendStatus(w.trx, sendId)) === "rejected");
    // The server edits the same message into the reason card.
    await until(
      "reason buttons",
      async () =>
        (await w.client.read(w.a.chatId))
          .find((card) => card.messageId === message.messageId)
          ?.buttons.flat()
          .some((button) => button.data === `rw:p:${sendId}`) ?? false
    );

    // The lab process restarts between the two presses: the reason comes from the stored event.
    w.restart();
    expect(await w.tick()).toEqual({ planned: 1, pressed: 0, unmapped: 0, noRule: 0 });
    expect(
      w
        .events()
        .filter((event) => event.t === "tap_planned")
        .at(-1)
    ).toMatchObject({
      data: `rw:p:${sendId}`,
      messageId: message.messageId,
    });
    w.clock.at = new Date("2026-11-23T15:00:00Z");
    expect((await w.tick()).pressed).toBe(1);
    await until("reject reason saved", async () => {
      const row = await getActionFeedback(w.trx, { orgId: w.a.orgId }, sendId, "reject_reason");
      return row?.reason === "wrong_person";
    });
    expect(w.callbackData(w.a.chatId)).toEqual([`ar:${sendId}`, `rw:p:${sendId}`]);
    expect((await w.tick()).planned).toBe(0);
    // Each press writes its intent before the press and its done after it: planned, intent, done, in this order, once.
    // A press with no intent would be pressed again and answered 404 (the button is gone): `tap_gone` shows it.
    const tapEvents = w
      .events()
      .filter((event) => event.t.startsWith("tap_") || (event.t === "skip" && event.code === "tap_gone"))
      .map((event) => [event.t, (event as { key?: string; ref?: string }).key ?? (event as { ref?: string }).ref]);
    const arKey = `${message.messageId}:ar:${sendId}`;
    const rwKey = `${message.messageId}:rw:p:${sendId}`;
    expect(tapEvents).toEqual([
      ["tap_planned", arKey],
      ["tap_intent", arKey],
      ["tap_done", arKey],
      ["tap_planned", rwKey],
      ["tap_intent", rwKey],
      ["tap_done", rwKey],
    ]);
  });
}, 60_000);

test("3: an applied move of an urgent mail and its digest card with Undo: one fu: press; the Undo starts", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const emailId = await movedMail(w, "w-1-011", "urgent", "ai_info");
    const digest = await digestCard(w);
    expect(digest.buttons.flat().map((button) => button.data)).toContain(`fu:${emailId}`);

    expect((await w.tick()).planned).toBe(1);
    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect((await w.tick()).pressed).toBe(1);
    // The test and the server share one connection: a read can run between the Undo's reverse row and its feedback row.
    // The feedback row is the last write of the Undo transaction, so wait for it, then read both.
    const readFeedback = () =>
      w.trx.selectFrom("triage_feedback").select("source").where("email_id", "=", emailId).execute();
    await until("undo feedback row", async () => (await readFeedback()).length > 0);
    const reverses = await w.trx
      .selectFrom("actions")
      .select("id")
      .where("email_id", "=", emailId)
      .where("reverses_action_id", "is not", null)
      .execute();
    expect(reverses).toHaveLength(1);
    expect(await readFeedback()).toEqual([{ source: "undo" }]);
    expect(w.callbackData(w.a.chatId)).toEqual([`fu:${emailId}`]);
  });
}, 60_000);

test("4: a card for a non-lab mail, and one for a mail of another run, get no press and count as unmapped", async () => {
  await withWorld(async (w) => {
    await w.tick();
    await approvalCard(w, { to: RIGHT_DELEGATE, messageId: `<other-${Date.now()}@${DOMAIN}>` });
    await approvalCard(w, { to: RIGHT_DELEGATE, messageId: labId("w-1-008", "day-20261130-ffff") });
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 2, noRule: 0 });
    w.clock.at = new Date("2026-11-23T20:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(kinds(w.events())).not.toContain("tap_planned");
    expect(w.events().filter((event) => event.t === "skip")).toHaveLength(2);
  });
}, 60_000);

// Every button prefix of the executive: after a tap_intent with no tap_done, no press of any kind follows.
const PREFIXES = ["ap", "ar", "rw:p", "as", "ag", "fu"] as const;

test("5: tap_intent without tap_done: the next tick presses nothing of any kind and writes skip tap_unsure once", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const { sendId, message } = await approvalCard(w, { to: RIGHT_DELEGATE });
    await w.tick();
    // Crash: a press fails on the wire after the intent is on disk.
    const real = w.deps.tg;
    let pressCalls = 0;
    w.deps.tg = {
      ...real,
      press: async () => {
        pressCalls += 1;
        throw new Error("connection lost");
      },
    };
    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(pressCalls).toBe(1);
    expect(kinds(w.events()).filter((type) => type === "tap_intent")).toHaveLength(1);
    expect(kinds(w.events())).not.toContain("tap_done");

    // The process restarts with a healthy client: the intent blocks the press.
    w.deps.tg = real;
    w.restart();
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(await sendStatus(w.trx, sendId)).toBe("awaiting_approval");
    expect(w.events().filter((event) => event.t === "skip")).toEqual([
      expect.objectContaining({ code: "tap_unsure", ref: `${message.messageId}:ap:${sendId}` }),
    ]);

    // The same for each button kind: a planned tap with an intent and no done is never pressed.
    const idOf = "00000000-0000-4000-8000-000000000001";
    let presses = 0;
    w.deps.tg = {
      ...real,
      press: async () => {
        presses += 1;
      },
    };
    for (const [index, prefix] of PREFIXES.entries()) {
      const data = `${prefix}:${idOf}`;
      const key = `${900 + index}:${data}`;
      w.state.append(runId, { t: "tap_planned", key, at: "2026-11-23T08:05:00.000Z", data, messageId: 900 + index });
      w.state.append(runId, { t: "tap_intent", key, data });
    }
    await w.tick();
    await w.tick();
    expect(presses).toBe(0);
    const unsure = w.events().filter((event) => event.t === "skip" && event.code === "tap_unsure");
    expect(unsure).toHaveLength(PREFIXES.length + 1);
  });
}, 60_000);

test("5b: a digest message with feedback buttons for 3 mails: one fu: press, for the wrongly moved urgent mail only", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const urgent = await movedMail(w, "w-1-011", "urgent", "ai_info");
    const info = await movedMail(w, "w-1-002", "info", "ai_info");
    const spam = await movedMail(w, "w-1-005", "spam", "ai_spam");
    const digest = await digestCard(w);
    const data = digest.buttons.flat().map((button) => button.data);
    for (const id of [urgent, info, spam]) expect(data).toContain(`fu:${id}`);

    expect(await w.tick()).toMatchObject({ planned: 1, pressed: 0, unmapped: 0 });
    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect((await w.tick()).pressed).toBe(1);
    await until("undo reverse row", async () => {
      const rows = await w.trx
        .selectFrom("actions")
        .select("email_id")
        .where("reverses_action_id", "is not", null)
        .execute();
      return rows.length === 1;
    });
    const reversed = await w.trx
      .selectFrom("actions")
      .select("email_id")
      .where("reverses_action_id", "is not", null)
      .execute();
    expect(reversed).toEqual([{ email_id: urgent }]);
    expect(w.callbackData(w.a.chatId)).toEqual([`fu:${urgent}`]);
  });
}, 60_000);

test("6: a card in the other org's chat is never read or pressed; a card in the lab chat with another org's id is unmapped", async () => {
  await withWorld(async (w) => {
    await w.tick();
    // The other org (the `demo` org of orgs.json) holds a valid approval card of its own in its own chat.
    const other = await approvalCard(w, { org: w.b, to: RIGHT_DELEGATE });
    await w.tick();
    w.clock.at = new Date("2026-11-23T20:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.callbackData(w.b.chatId)).toEqual([]);
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(await sendStatus(w.trx, other.sendId)).toBe("awaiting_approval");
    expect(kinds(w.events())).not.toContain("tap_planned");

    // Cards in the lab chat that name the other org's send and the other org's wrongly moved urgent mail: the lookups
    // filter by org, so both cards are unmapped.
    const otherMoved = await movedMail(w, "w-1-011", "urgent", "ai_info", w.b);
    w.fake.state.botSend({
      chatId: w.a.chatId,
      text: "forged",
      buttons: [[{ text: "Approve", data: `ap:${other.sendId}` }]],
    });
    w.fake.state.botSend({
      chatId: w.a.chatId,
      text: "forged",
      buttons: [[{ text: "Undo", data: `fu:${otherMoved}` }]],
    });
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 2, noRule: 0 });
    w.clock.at = new Date("2026-11-24T08:00:00Z");
    await w.tick();
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(await sendStatus(w.trx, other.sendId)).toBe("awaiting_approval");
  });
}, 60_000);

test("7: a fake restart (no chat, or the newest id below the seen id): skip fake_restarted, no crash, no press", async () => {
  await withWorld(async (w) => {
    await w.tick();
    expect((await w.client.read(w.a.chatId)).length).toBeGreaterThanOrEqual(2);
    const seen = w
      .events()
      .filter((event) => event.t === "seen")
      .at(-1);
    expect(Number((seen as { ref: string }).ref)).toBeGreaterThanOrEqual(2);

    // A new fake with the chat known (one user message): its newest id is below the seen id.
    const restarted = startFakeTelegram();
    fakes.push(restarted);
    const next = createFakeTgClient(restarted.apiRoot);
    await next.send(w.a.chatId, "/help");
    w.deps.tg = next;
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    const skips = w.events().filter((event) => event.t === "skip");
    expect(skips).toEqual([expect.objectContaining({ code: "fake_restarted", ref: String(w.a.chatId) })]);
    expect(
      w
        .events()
        .filter((event) => event.t === "seen")
        .at(-1)
    ).toMatchObject({ ref: "1" });
    // Seen is reset: the next tick reads from message 1 on and adds no second skip.
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.events().filter((event) => event.t === "skip")).toHaveLength(1);

    // A fake with no chat at all.
    const empty = startFakeTelegram();
    fakes.push(empty);
    w.deps.tg = createFakeTgClient(empty.apiRoot);
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.events().filter((event) => event.t === "skip" && event.code === "fake_restarted")).toHaveLength(2);
    expect(
      w
        .events()
        .filter((event) => event.t === "seen")
        .at(-1)
    ).toMatchObject({ ref: "0" });
    // A dead chat is reported once.
    await w.tick();
    expect(w.events().filter((event) => event.t === "skip" && event.code === "fake_restarted")).toHaveLength(2);
    expect(kinds(w.events())).not.toContain("tap_planned");
  });
}, 60_000);

test("7b: cards older than the start of the run are never pressed", async () => {
  await withWorld(async (w) => {
    // Two valid cards exist before the first tick of the run: a reused chat.
    const old = await approvalCard(w, { to: RIGHT_DELEGATE });
    const oldWrong = await approvalCard(w, { to: WRONG_DELEGATE, slotId: "w-1-017" });
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    w.clock.at = new Date("2026-11-23T20:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(await sendStatus(w.trx, old.sendId)).toBe("awaiting_approval");
    expect(await sendStatus(w.trx, oldWrong.sendId)).toBe("awaiting_approval");
    expect(kinds(w.events())).toEqual(["seen"]);

    // A card after the start is read.
    const fresh = await approvalCard(w, { to: RIGHT_DELEGATE, slotId: "w-1-018" });
    expect((await w.tick()).planned).toBe(1);
    expect(w.events().find((event) => event.t === "tap_planned")).toMatchObject({ data: `ap:${fresh.sendId}` });
  });
}, 60_000);

test("TG1: two digests list the same wrongly moved urgent mail: one fu: press and skip tap_repeat", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const emailId = await movedMail(w, "w-1-011", "urgent", "ai_info");
    const first = await digestCard(w);
    expect(await w.tick()).toMatchObject({ planned: 1 });
    const second = await digestCard(w);
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.buttons.flat().map((button) => button.data)).toContain(`fu:${emailId}`);
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.events().filter((event) => event.t === "skip")).toEqual([
      expect.objectContaining({ code: "tap_repeat", ref: `${second.messageId}:fu:${emailId}` }),
    ]);
    expect(w.events().filter((event) => event.t === "tap_planned")).toHaveLength(1);

    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect((await w.tick()).pressed).toBe(1);
    await until("undo reverse row", async () => {
      const rows = await w.trx
        .selectFrom("actions")
        .select("id")
        .where("email_id", "=", emailId)
        .where("reverses_action_id", "is not", null)
        .execute();
      return rows.length === 1;
    });
    expect(w.callbackData(w.a.chatId)).toEqual([`fu:${emailId}`]);
    expect(kinds(w.events()).filter((type) => type === "tap_intent")).toHaveLength(1);
  });
}, 60_000);

test("TG2: a press the fake refuses (the button is gone) writes tap_gone, not tap_done, and is not tried again", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const { sendId, message } = await approvalCard(w, { to: RIGHT_DELEGATE });
    expect((await w.tick()).planned).toBe(1);
    // The card loses its buttons before the press: the fake answers 404 and queues no callback.
    w.fake.state.botEdit({ chatId: w.a.chatId, messageId: message.messageId, text: "gone", buttons: [] });
    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    const key = `${message.messageId}:ap:${sendId}`;
    expect(w.events().filter((event) => event.t.startsWith("tap_") || event.t === "skip")).toEqual([
      expect.objectContaining({ t: "tap_planned", key }),
      expect.objectContaining({ t: "tap_intent", key }),
      expect.objectContaining({ t: "skip", code: "tap_gone", ref: key }),
    ]);
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(await sendStatus(w.trx, sendId)).toBe("awaiting_approval");
    await w.tick();
    expect(kinds(w.events()).filter((type) => type === "tap_intent")).toHaveLength(1);
  });
}, 60_000);

test("TG2: a stopped run is not read and presses nothing, even a planned tap", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const { sendId } = await approvalCard(w, { to: RIGHT_DELEGATE });
    expect((await w.tick()).planned).toBe(1);
    await approvalCard(w, { to: RIGHT_DELEGATE, slotId: "w-1-017" });
    w.state.stopRun(runId, "operator");
    const before = w.events().length;
    w.clock.at = new Date("2026-11-23T12:00:00Z");
    expect(await w.tick()).toEqual({ planned: 0, pressed: 0, unmapped: 0, noRule: 0 });
    expect(w.events()).toHaveLength(before);
    expect(w.callbackData(w.a.chatId)).toEqual([]);
    expect(await sendStatus(w.trx, sendId)).toBe("awaiting_approval");
  });
}, 60_000);

test("TG2: an as: press on a reminder set card approves the set; an ag: press on a failed send creates a new send", async () => {
  await withWorld(async (w) => {
    await w.tick();
    const ctx = { orgId: w.a.orgId };
    const setId = randomUUID();
    const reminder = await insertDraftAndSend(w.trx, ctx, w.a.mailboxId, {
      reminder: 1,
      setId,
      to: RIGHT_DELEGATE,
      messageId: labId("w-1-008"),
      createdAt: new Date(),
    });
    const failed = await insertDraftAndSend(w.trx, ctx, w.a.mailboxId, {
      to: RIGHT_DELEGATE,
      messageId: labId("w-1-017"),
      sendStatus: "failed",
      createdAt: new Date(),
    });
    await w.trx
      .updateTable("actions")
      .set({ status_reason: "smtp_error" })
      .where("id", "=", failed.sendId)
      .where("org_id", "=", w.a.orgId)
      .execute();
    await w.runtime.notify();
    const buttons = async (): Promise<string[]> =>
      (await w.client.read(w.a.chatId)).flatMap((message) => message.buttons.flat().map((button) => button.data));
    await until("set and failed cards", async () => {
      const data = await buttons();
      return data.includes(`as:${setId}`) && data.includes(`ag:${failed.sendId}`);
    });

    expect((await w.tick()).planned).toBe(2);
    w.clock.at = new Date("2026-11-24T12:00:00Z");
    expect((await w.tick()).pressed).toBe(2);
    await until("set approved", async () => (await sendStatus(w.trx, reminder.sendId)) === "approved");
    await until("new send for the failed one", async () => {
      const rows = await w.trx
        .selectFrom("actions")
        .select("id")
        .where("email_id", "=", failed.emailId)
        .where("type", "=", "send")
        .execute();
      return rows.length === 2;
    });
    expect(w.callbackData(w.a.chatId).sort()).toEqual([`ag:${failed.sendId}`, `as:${setId}`].sort());
    // No second ag: for the same action, even after the new send card appears.
    await w.tick();
    expect(w.callbackData(w.a.chatId)).toHaveLength(2);
  });
}, 60_000);

test("lookupCard reads only the rows of its organization: a send, a reminder set and a mail", async () => {
  await withWorld(async (w) => {
    const ctxA = { orgId: w.a.orgId };
    const ctxB = { orgId: w.b.orgId };
    const { sendId, emailId } = await insertDraftAndSend(w.trx, ctxA, w.a.mailboxId, {
      to: RIGHT_DELEGATE,
      messageId: labId("w-1-008"),
    });
    expect(await lookupCard(w.trx, ctxA, { actionId: sendId })).toEqual({
      messageId: labId("w-1-008"),
      draft: { kind: "delegation", recipient: RIGHT_DELEGATE },
    });
    expect(await lookupCard(w.trx, ctxB, { actionId: sendId })).toBeNull();

    const setId = "11111111-1111-4111-8111-111111111111";
    await insertDraftAndSend(w.trx, ctxA, w.a.mailboxId, {
      reminder: 1,
      setId,
      to: RIGHT_DELEGATE,
      messageId: labId("w-1-017"),
    });
    expect(await lookupCard(w.trx, ctxA, { setId })).toEqual({
      messageId: labId("w-1-017"),
      draft: { kind: "other", recipient: RIGHT_DELEGATE },
    });
    expect(await lookupCard(w.trx, ctxB, { setId })).toBeNull();

    const moved = await movedMail(w, "w-1-011", "urgent", "ai_info");
    expect(await lookupCard(w.trx, ctxA, { emailId: moved })).toEqual({ messageId: labId("w-1-011"), moved: true });
    expect(await lookupCard(w.trx, ctxB, { emailId: moved })).toBeNull();
    // Not moved (a delegation mail with no move row), and an undone move.
    expect(await lookupCard(w.trx, ctxA, { emailId })).toEqual({ messageId: labId("w-1-008"), moved: false });
    await w.trx.updateTable("actions").set({ status: "undone" }).where("email_id", "=", moved).execute();
    expect(await lookupCard(w.trx, ctxA, { emailId: moved })).toEqual({ messageId: labId("w-1-011"), moved: false });
  });
}, 60_000);
