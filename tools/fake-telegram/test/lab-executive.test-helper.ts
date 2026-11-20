import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { labMessageId, planLiveRun, type LiveRunPlan, MINUTE_MS, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { noDelegationHooks } from "../../../apps/server/src/modules/actions";
import { createTelegramRuntime } from "../../../apps/server/src/modules/channels";
import {
  createFakeTgClient,
  createLabState,
  loadLabCorpus,
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
import { withRollback, type testDb } from "../../../apps/server/test/integration/helpers";
import { FAKE_TOKEN, startFakeTelegram } from "../src";

import { timeZoneOutsideQuietHours } from "./setup";

// Shared by the executive driver tests (`lab-executive-*.test.ts`): the driver against the real fake Telegram, the
// server's Telegram runtime and the DB. The cards of the approval cases are the real ones (the outbox notices of the
// runtime). The cards of the digest cases are the real `/digest` answer. Cards that only need an id are built by
// `botSend` from button data.
const SIM_ROOT = resolve(import.meta.dir, "../../../evals/sim");
const WAIT_MS = 10_000;
export const DOMAIN = "kordelan.test";

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
export const { runId } = plan;

// Slots of lab-01 (checked in `slotOf`): w-1-008 delegation to `asystentka`, w-1-011 urgent, w-1-002 info, w-1-005 spam.
export const slotOf = (id: string, category: string) => {
  const slot = corpus.slots.get(id);
  if (slot?.category !== category) throw new Error(`slot ${id} is not ${category}`);
  return slot;
};
const addressOf = (key: string): string => {
  const persona = corpus.scenario.personas.find((candidate) => candidate.key === key);
  if (persona === undefined) throw new Error(`persona ${key}`);
  return persona.address;
};
export const labId = (slotId: string, run = runId): string => labMessageId(slotId, run, DOMAIN);

export const WRONG_DELEGATE = addressOf("koordynator-sprzedazy");
export const RIGHT_DELEGATE = addressOf("asystentka");

export async function until(what: string, check: () => Promise<boolean>, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(`until: ${what} not true after ${timeoutMs} ms`);
    await Bun.sleep(25);
  }
}

export interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
  chatId: number;
}

export interface World {
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

export const sendStatus = async (trx: Transaction<DB>, sendId: string): Promise<string> =>
  (await trx.selectFrom("actions").select("status").where("id", "=", sendId).executeTakeFirstOrThrow()).status;

export const kinds = (events: readonly LoggedLabEvent[]): string[] => events.map((event) => event.t);

/** The world builders of one test file: each part builds its own kit over its own `db`. */
export function makeExecutiveKit(db: ReturnType<typeof testDb>) {
  const dirs: string[] = [];
  const fakes: { stop(): Promise<void> }[] = [];

  async function cleanup(): Promise<void> {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    await Promise.all(fakes.splice(0).map((fake) => fake.stop()));
  }

  async function withWorld(fn: (world: World) => Promise<void>): Promise<void> {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      await isolateChannels(trx);
      const fake = startFakeTelegram();
      fakes.push(fake);
      const client = createFakeTgClient(fake.apiRoot);
      const startedAt = new Date(Date.now() - HOUR_MS);
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

        const dir = mkdtempSync(join(tmpdir(), "lab-executive-"));
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
      createdAt: new Date(Date.now() - 10 * MINUTE_MS),
      messageId: labId(slotId),
      folder,
      movedAt: new Date(Date.now() - 5 * MINUTE_MS),
      actions: [
        { type: "move", status: "applied", payload: { folder }, appliedAt: new Date(Date.now() - 5 * MINUTE_MS) },
      ],
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

  return { fakes, cleanup, withWorld, approvalCard, movedMail, digestCard };
}
