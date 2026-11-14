import type { Category } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { auditEvents, countLlmCallsSince, recordAudit } from "../../src/modules/audit";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { claimEmails, ensureSyncFolders, getJunkFolderPath, type ClaimedEmail } from "../../src/modules/mail";
import { NO_TEST_SENDERS, type TestMailRule } from "../../src/modules/mail";
import {
  finishTriageError,
  saveTriage,
  triageOne,
  type LlmPause,
  type TriageDecision,
  type TriageMailbox,
} from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import {
  LlmBlockedError,
  LlmConfigError,
  LlmHardError,
  LlmOutputError,
  LlmSoftError,
  type LlmClient,
} from "../../src/platform/llm";

import { createOrgWithMailbox, insertAction, insertDelegate, insertDelegation, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-05T12:00:00.123Z");

async function setup(trx: Transaction<DB>) {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  const settings = await getMailboxSettings(trx, ctx, created.mailboxId);
  if (!settings) throw new Error("no settings");
  const emailId = await insertTestEmail(trx, ctx, created.mailboxId);
  const [email] = await claimEmails(trx, ctx, created.mailboxId, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * 60_000),
    syntheticOnly: false,
  });
  if (!email) throw new Error("claim failed");
  const mailbox: TriageMailbox = {
    id: created.mailboxId,
    settingsVersion: settings.version,
    mode: "shadow",
    toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
    policy: { info: { auto: true } },
    rules: [],
    movesSupported: true,
    delegates: [],
    timezone: "Europe/Warsaw",
    junkFolder: null,
    resumedAt: null,
  };
  return { ctx, emailId, email, mailbox };
}

function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    finalCategory: "info",
    modelCategory: "info",
    confidence: 0.9,
    reasonCode: "newsletter",
    reason: "a newsletter",
    summary: "short summary",
    fields: { lang: "pl" },
    vip: false,
    model: "m",
    promptVersion: "classifier-v1",
    usage: {
      role: "classifier",
      promptVersion: "classifier-v1",
      model: "m",
      tokensIn: 120,
      tokensOut: 30,
      latencyMs: 850,
    },
    auditReasonCode: "newsletter",
    delegation: null,
    ...overrides,
  };
}

async function results(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("triage_results")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function audit(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

async function emailStatus(trx: Transaction<DB>, emailId: string): Promise<string> {
  const row = await trx.selectFrom("emails").select("status").where("id", "=", emailId).executeTakeFirstOrThrow();
  return row.status;
}

describe("saveTriage", () => {
  test("saves an info decision: result, actions and audit rows", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      expect(await saveTriage(trx, ctx, mailbox, email, decision(), now)).toEqual({ kind: "triaged" });
      expect(await emailStatus(trx, emailId)).toBe("triaged");

      const rows = await results(trx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        category: "info",
        model: "m",
        prompt_version: "classifier-v1",
        tokens_in: 120,
        tokens_out: 30,
        latency_ms: 850,
        reason_code: "newsletter",
      });
      expect(rows[0]?.fields).toEqual({ lang: "pl", model_category: "info" });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["move", "logged"],
        ["save_summary", "ready"],
      ]);
      const move = actions.find((a) => a.type === "move");
      expect(move?.payload).toEqual({ folder: "ai_info" });

      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(1);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      const triaged = log.find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("newsletter");
      expect(triaged?.data).toEqual({
        mailbox_id: mailbox.id,
        final_category: "info",
        model_category: "info",
        confidence: 0.9,
        prompt_version: "classifier-v1",
        model: "m",
      });
      expect(JSON.stringify(log.map((r) => r.data))).not.toContain("short summary");
    });
  });

  test("a below-threshold decision keeps the model's reason code and logs the move", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      const below = decision({
        finalCategory: "unsure",
        modelCategory: "info",
        confidence: 0.5,
        reasonCode: "fyi",
        summary: null,
        auditReasonCode: "below_threshold",
      });
      expect(await saveTriage(trx, ctx, mailbox, email, below, now)).toEqual({ kind: "triaged" });

      const rows = await results(trx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: "unsure", reason_code: "fyi", confidence: 0.5 });
      expect(rows[0]?.fields).toEqual({ lang: "pl", model_category: "info" });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status, a.payload])).toEqual([["move", "logged", { folder: "ai_manual" }]]);
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("below_threshold");
    });
  });

  test("stores NULL tokens without usage and no model_category without a model category", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision({ usage: null, modelCategory: null, model: null }), now);
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ tokens_in: null, tokens_out: null, latency_ms: null, model: null });
      expect(row?.fields).toEqual({ lang: "pl" });
    });
  });

  test("a lost claim returns lost, writes nothing and does not break the transaction", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + 60_000) })
        .where("id", "=", emailId)
        .execute();
      expect(await saveTriage(trx, ctx, mailbox, email, decision(), now)).toEqual({ kind: "lost" });
      expect(await results(trx, emailId)).toHaveLength(0);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(0);
      expect(await audit(trx, emailId)).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("processing");
    });
  });

  test("a second save creates a second result but no second set of actions", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision(), now);
      await trx.updateTable("emails").set({ status: "pending" }).where("id", "=", emailId).execute();
      const [again]: ClaimedEmail[] = await claimEmails(trx, ctx, mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      if (!again) throw new Error("second claim failed");
      expect(await saveTriage(trx, ctx, mailbox, again, decision(), now)).toEqual({ kind: "triaged" });

      expect(await results(trx, emailId)).toHaveLength(2);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(2);
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(2);
    });
  });
});

interface FakeLlm extends LlmClient {
  requests: { system: string; prompt: string }[];
}

function fakeLlm(answer: (() => unknown) | Error): FakeLlm {
  const requests: { system: string; prompt: string }[] = [];
  return {
    modelOf: () => "fake-model",
    requests,
    async generate(req) {
      requests.push({ system: req.system, prompt: req.prompt });
      if (answer instanceof Error) throw answer;
      return {
        data: req.schema.parse(answer()),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: "fake-model",
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 300,
        },
      };
    },
  } as FakeLlm;
}

const analysis =
  (overrides: Record<string, unknown> = {}) =>
  () => ({
    category: "info",
    confidence: 0.9,
    reason_code: "newsletter",
    reason: "a newsletter",
    summary: "short summary",
    fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
    ...overrides,
  });

interface FakePause extends LlmPause {
  trips: { kind: string; code: string }[];
  resets: number;
}

function fakePause(): FakePause {
  return {
    trips: [],
    resets: 0,
    trip(kind, code, at) {
      this.trips.push({ kind, code });
      return new Date(at.getTime() + 5 * 60_000);
    },
    isPaused: () => false,
    reset() {
      this.resets += 1;
    },
  };
}

async function setupMail(
  trx: Transaction<DB>,
  overrides: Parameters<typeof insertTestEmail>[3] = {},
  rules: TriageMailbox["rules"] = [],
  syntheticOnly: false | { testMail: TestMailRule } = false
) {
  const base = await setup(trx);
  const emailId = await insertTestEmail(trx, base.ctx, base.mailbox.id, overrides);
  const claimed = await claimEmails(trx, base.ctx, base.mailbox.id, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * 60_000),
    syntheticOnly,
  });
  const email = claimed.find((row) => row.id === emailId);
  if (!email) throw new Error("claim failed");
  return { ...base, emailId, email, mailbox: { ...base.mailbox, rules } };
}

async function llmRows(trx: Transaction<DB>, emailId: string) {
  return (await audit(trx, emailId)).filter((r) => r.event === "llm.call");
}

describe("triageOne", () => {
  test("an info mail is triaged with one ok llm.call row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "news@shop.test" });
      const llm = fakeLlm(analysis());
      expect(
        await triageOne(
          { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
          ctx,
          mailbox,
          email
        )
      ).toEqual({
        kind: "triaged",
      });

      expect(llm.requests).toHaveLength(1);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({
        category: "info",
        reason_code: "newsletter",
        model: "fake-model",
        prompt_version: "classifier-v2",
        tokens_in: 100,
        tokens_out: 20,
      });
      const calls = await llmRows(trx, emailId);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.reason_code).toBe("ok");
      expect(calls[0]?.data).toEqual({
        mailbox_id: mailbox.id,
        role: "classifier",
        model: "fake-model",
        prompt_version: "classifier-v2",
        tokens_in: 100,
        tokens_out: 20,
        latency_ms: 300,
      });
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(1);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(2);
    });
  });

  test("a blocklist sender is spam without an LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "bad@spam.test" }, [
        { pattern: "spam.test", kind: "blocklist" },
      ]);
      const llm = fakeLlm(analysis());
      expect(
        await triageOne(
          { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
          ctx,
          mailbox,
          email
        )
      ).toEqual({
        kind: "triaged",
      });

      expect(llm.requests).toHaveLength(0);
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "spam", model: null, reason_code: "blocklist", confidence: 1 });
      expect(await llmRows(trx, emailId)).toHaveLength(0);
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("blocklist");
    });
  });

  test("a whitelisted sender gets an allowed list without spam", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox } = await setupMail(trx, { from_address: "boss@corp.test" }, [
        { pattern: "corp.test", kind: "whitelist" },
      ]);
      const llm = fakeLlm(analysis());
      await triageOne(
        { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );

      expect(llm.requests).toHaveLength(1);
      const system = llm.requests[0]?.system ?? "";
      const other = fakeLlm(analysis());
      const plain = await setupMail(trx, { from_address: "someone@else.test" });
      await triageOne(
        { db: trx, llm: other, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        plain.ctx,
        plain.mailbox,
        plain.email
      );
      expect(other.requests[0]?.system).not.toBe(system);
      expect(other.requests[0]?.system).toContain("spam");
      expect(system).not.toContain("spam");
    });
  });

  test("confidence below the threshold gives unsure with the below_threshold code", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = fakeLlm(analysis({ confidence: 0.5, reason_code: "fyi" }));
      await triageOne(
        { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );

      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "unsure", reason_code: "fyi", confidence: 0.5 });
      expect(row?.fields).toMatchObject({ model_category: "info" });
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("below_threshold");
    });
  });

  test("a soft error pauses, releases the mail without a count and writes no result", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = fakeLlm(new LlmSoftError("http_429", "fake-model"));
      const pause = fakePause();
      const outcome = await triageOne(
        { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );

      const until = new Date(now.getTime() + 5 * 60_000);
      expect(outcome).toEqual({ kind: "paused", until });
      expect(pause.trips).toEqual([{ kind: "soft", code: "http_429" }]);
      const mail = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
      expect(mail).toMatchObject({ status: "pending", attempts: 0, locked_at: null });
      expect(mail.next_attempt_at).toEqual(until);
      expect(await results(trx, emailId)).toHaveLength(0);
      const calls = await llmRows(trx, emailId);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.reason_code).toBe("http_429");
      expect(calls[0]?.data).toMatchObject({
        role: "classifier",
        prompt_version: "classifier-v2",
        model: "fake-model",
        tokens_in: null,
        tokens_out: null,
      });
    });
  });

  test("a config error pauses with the config kind and counts nothing", async () => {
    for (const code of ["http_404", "http_400_key"] as const) {
      await withRollback(db, async (trx) => {
        const { ctx, emailId, email, mailbox } = await setupMail(trx);
        const llm = fakeLlm(new LlmConfigError(code, "fake-model"));
        const pause = fakePause();
        const outcome = await triageOne(
          { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
          ctx,
          mailbox,
          email
        );

        expect(outcome.kind).toBe("paused");
        expect(pause.trips).toEqual([{ kind: "config", code }]);
        const mail = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
        expect(mail).toMatchObject({ status: "pending", attempts: 0 });
        expect(await results(trx, emailId)).toHaveLength(0);
        expect((await llmRows(trx, emailId))[0]?.reason_code).toBe(code);
      });
    }
  });

  test("a safety block goes to unsure at once, without retry, count or pause", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = fakeLlm(new LlmBlockedError("fake-model"));
      const pause = fakePause();
      const outcome = await triageOne(
        { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );

      expect(outcome).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(1);
      expect(pause.trips).toHaveLength(0);
      expect(pause.resets).toBe(1);
      const mail = await trx
        .selectFrom("emails")
        .select(["status", "attempts"])
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(mail).toEqual({ status: "triaged", attempts: 0 });
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({
        category: "unsure",
        reason_code: "llm_blocked",
        confidence: 0,
        model: null,
        tokens_in: null,
      });
      const log = await audit(trx, emailId);
      expect(log.find((r) => r.event === "email.triaged")?.reason_code).toBe("llm_blocked");
      const calls = await llmRows(trx, emailId);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.reason_code).toBe("llm_blocked");
      expect(calls[0]?.data).toMatchObject({
        role: "classifier",
        prompt_version: "classifier-v2",
        model: "fake-model",
      });
    });
  });

  test("finishTriageError saves unsure with the triage_error code", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const deps = {
        db: trx,
        llm: fakeLlm(analysis()),
        pause: fakePause(),
        testMail: NO_TEST_SENDERS,
        dailyCap: 1000,
        now: () => now,
      };
      expect(await finishTriageError(deps, ctx, mailbox, email)).toEqual({ kind: "triaged" });
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "unsure", reason_code: "triage_error", confidence: 0, model: null });
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("triage_error");
    });
  });

  test("three hard or output errors: two retries, then unsure with triage_error; each call counts", async () => {
    const errors = [new LlmHardError("http_400", "fake-model"), new LlmOutputError("fake-model")];
    for (const error of errors) {
      await withRollback(db, async (trx) => {
        const first = await setupMail(trx);
        const { ctx, emailId, mailbox } = first;
        const llm = fakeLlm(error);
        const pause = fakePause();
        let clock = now;
        let email = first.email;
        const attemptsAfter: number[] = [];

        for (let run = 1; run <= 3; run += 1) {
          const outcome = await triageOne(
            { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => clock },
            ctx,
            mailbox,
            email
          );
          if (run < 3) {
            expect(outcome).toEqual({ kind: "retry_later" });
            const mail = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
            attemptsAfter.push(mail.attempts);
            expect(mail.status).toBe("pending");
            expect(mail.next_attempt_at).toEqual(new Date(clock.getTime() + 5 * 60_000));
            clock = new Date(clock.getTime() + 6 * 60_000);
            const claimed = await claimEmails(trx, ctx, mailbox.id, {
              now: clock,
              limit: 10,
              staleBefore: new Date(clock.getTime() - 5 * 60_000),
              syntheticOnly: false,
            });
            const again = claimed.find((row) => row.id === emailId);
            if (!again) throw new Error("claim failed");
            email = again;
          } else {
            expect(outcome).toEqual({ kind: "triaged" });
          }
        }

        expect(attemptsAfter).toEqual([1, 2]);
        expect(pause.trips).toHaveLength(0);
        const [row] = await results(trx, emailId);
        expect(row).toMatchObject({ category: "unsure", reason_code: "triage_error", confidence: 0, model: null });
        expect(await emailStatus(trx, emailId)).toBe("triaged");
        expect(await countLlmCallsSince(trx, ctx, mailbox.id, new Date(now.getTime() - 60_000))).toBe(3);
      });
    }
  });

  test("a lost claim on release returns lost in the soft path and in the hard-retry path", async () => {
    for (const error of [new LlmSoftError("http_429", "fake-model"), new LlmHardError("http_400", "fake-model")]) {
      await withRollback(db, async (trx) => {
        const { ctx, emailId, email, mailbox } = await setupMail(trx);
        await trx
          .updateTable("emails")
          .set({ locked_at: new Date(now.getTime() + 60_000) })
          .where("id", "=", emailId)
          .execute();
        const outcome = await triageOne(
          {
            db: trx,
            llm: fakeLlm(error),
            pause: fakePause(),
            testMail: NO_TEST_SENDERS,
            dailyCap: 1000,
            now: () => now,
          },
          ctx,
          mailbox,
          email
        );

        expect(outcome).toEqual({ kind: "lost" });
        const mail = await trx
          .selectFrom("emails")
          .select(["status", "attempts"])
          .where("id", "=", emailId)
          .executeTakeFirstOrThrow();
        expect(mail).toEqual({ status: "processing", attempts: 0 });
        expect(await results(trx, emailId)).toHaveLength(0);
      });
    }
  });

  test("a success after a soft error resets the pause", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const pause = fakePause();
      const soft = await triageOne(
        {
          db: trx,
          llm: fakeLlm(new LlmSoftError("http_429", "fake-model")),
          pause,
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          now: () => now,
        },
        ctx,
        mailbox,
        email
      );
      if (soft.kind !== "paused") throw new Error("expected a pause");
      expect(pause.trips).toHaveLength(1);
      expect(pause.resets).toBe(0);

      const clock = new Date(soft.until.getTime() + 1000);
      const claimed = await claimEmails(trx, ctx, mailbox.id, {
        now: clock,
        limit: 10,
        staleBefore: new Date(clock.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      const again = claimed.find((row) => row.id === emailId);
      if (!again) throw new Error("claim failed");

      const outcome = await triageOne(
        { db: trx, llm: fakeLlm(analysis()), pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => clock },
        ctx,
        mailbox,
        again
      );
      expect(outcome).toEqual({ kind: "triaged" });
      expect(pause.resets).toBe(1);
      expect(pause.trips).toHaveLength(1);
    });
  });

  test("a failed llm.call audit write does not hide the LLM error from the rules", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const failing = new Proxy(trx, {
        get(target, prop) {
          if (prop === "insertInto") {
            return (table: string) => {
              if (table === "audit_log") throw new Error("audit down");
              return (target.insertInto as (t: string) => unknown)(table);
            };
          }
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const warnSpy = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const pause = fakePause();
        const llm = fakeLlm(new LlmSoftError("http_503", "fake-model"));
        const outcome = await triageOne(
          { db: failing, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
          ctx,
          mailbox,
          email
        );

        expect(outcome.kind).toBe("paused");
        expect(pause.trips).toEqual([{ kind: "soft", code: "http_503" }]);
        expect(await llmRows(trx, emailId)).toHaveLength(0);
        const lines = warnSpy.mock.calls.map((call) => String(call[1]));
        expect(lines).toContain(`triage ${emailId}: llm.call audit write failed: Error`);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  test("older mails of the thread reach the prompt oldest first", async () => {
    await withRollback(db, async (trx) => {
      const threadKey = "thread:order";
      const base = await setup(trx);
      const markers = [
        ["FIRST-MARKER", "2026-11-05T08:00:00Z"],
        ["SECOND-MARKER", "2026-11-05T09:00:00Z"],
        ["THIRD-MARKER", "2026-11-05T10:00:00Z"],
      ] as const;
      for (const [index, [marker, at]] of markers.entries()) {
        await insertTestEmail(trx, base.ctx, base.mailbox.id, {
          thread_key: threadKey,
          message_id_header: `<order-${index}@corp.test>`,
          body_text: marker,
          received_at: new Date(at),
          status: "triaged",
        });
      }
      const currentId = await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<order-current@corp.test>",
        body_text: "current",
        received_at: new Date("2026-11-05T11:00:00Z"),
      });
      const claimed = await claimEmails(trx, base.ctx, base.mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      const email = claimed.find((row) => row.id === currentId);
      if (!email) throw new Error("claim failed");
      const llm = fakeLlm(analysis());
      await triageOne(
        { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        base.ctx,
        base.mailbox,
        email
      );

      const prompt = llm.requests[0]?.prompt ?? "";
      const positions = markers.map(([marker]) => prompt.indexOf(marker));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect(positions[0]).toBeLessThan(positions[1] ?? -1);
      expect(positions[1]).toBeLessThan(positions[2] ?? -1);
    });
  });

  test("a synthetic mail does not see real mail of its thread", async () => {
    await withRollback(db, async (trx) => {
      const threadKey = "thread:shared";
      const base = await setup(trx);
      await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<real@corp.test>",
        body_text: "REAL-MARKER-XYZ",
        received_at: new Date("2026-11-05T10:00:00Z"),
        status: "triaged",
      });
      await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<old@ea-seed.test>",
        body_text: "SYNTH-MARKER-ABC",
        received_at: new Date("2026-11-05T09:00:00Z"),
        status: "triaged",
      });
      const currentId = await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<a@ea-seed.test>",
        body_text: "current",
        received_at: new Date("2026-11-05T11:00:00Z"),
      });
      const claimed = await claimEmails(trx, base.ctx, base.mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * 60_000),
        syntheticOnly: { testMail: NO_TEST_SENDERS },
      });
      const email = claimed.find((row) => row.id === currentId);
      if (!email) throw new Error("claim failed");
      const llm = fakeLlm(analysis());
      await triageOne(
        { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => now },
        base.ctx,
        base.mailbox,
        email
      );

      const prompt = llm.requests[0]?.prompt ?? "";
      expect(prompt).not.toContain("REAL-MARKER-XYZ");
      expect(prompt).toContain("SYNTH-MARKER-ABC");
    });
  });
});

describe("triageOne: cost gates", () => {
  const dayStart = new Date("2026-11-05T08:00:00Z");
  const nextDayStart = new Date("2026-11-06T08:00:00Z");
  const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 3_600_000);

  function deps(trx: Transaction<DB>, llm: LlmClient, dailyCap = 1000) {
    return { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap, now: () => now };
  }

  async function addLlmCalls(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, at: Date[]) {
    for (const when of at) {
      await recordAudit(trx, ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: { mailbox_id: mailboxId },
        at: when,
      });
    }
  }

  test("a mail older than 7 days is skipped as too_old, without an LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { received_at: eightDaysAgo });
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "skipped" });

      expect(llm.requests).toHaveLength(0);
      const mail = await trx
        .selectFrom("emails")
        .select(["status", "skip_reason", "locked_at"])
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(mail).toEqual({ status: "skipped", skip_reason: "too_old", locked_at: null });
      const skipped = (await audit(trx, emailId)).filter((r) => r.event === "email.skipped");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.reason_code).toBe("too_old");
      expect(skipped[0]?.data).toEqual({ mailbox_id: mailbox.id });
      expect(await results(trx, emailId)).toHaveLength(0);
      expect(await llmRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a too_old mail with a lost claim returns lost and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { received_at: eightDaysAgo });
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + 60_000) })
        .where("id", "=", emailId)
        .execute();
      expect(await triageOne(deps(trx, fakeLlm(analysis())), ctx, mailbox, email)).toEqual({ kind: "lost" });
      expect(await emailStatus(trx, emailId)).toBe("processing");
      expect((await audit(trx, emailId)).filter((r) => r.event === "email.skipped")).toHaveLength(0);
    });
  });

  test("an 8-day-old mail with backfilled_at is triaged with an LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, {
        received_at: eightDaysAgo,
        backfilled_at: now,
      });
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(1);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
    });
  });

  test("a backfilled mail that lost its body to retention is skipped as body_expired; no LLM call (F083)", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, {
        received_at: eightDaysAgo,
        created_at: new Date(now.getTime() - 40 * 24 * 3_600_000),
        backfilled_at: now,
        body_text: null,
      });
      const llm = fakeLlm(analysis());

      expect(await triageOne(deps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "skipped" });

      expect(llm.requests).toHaveLength(0);
      const mail = await trx
        .selectFrom("emails")
        .select(["status", "skip_reason", "locked_at"])
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(mail).toEqual({ status: "skipped", skip_reason: "body_expired", locked_at: null });
      const skipped = (await audit(trx, emailId)).filter((r) => r.event === "email.skipped");
      expect(skipped.map((row) => row.reason_code)).toEqual(["body_expired"]);
      expect(await llmRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a backfilled mail with a body, or without a body but stored under 7 days ago, is triaged", async () => {
    await withRollback(db, async (trx) => {
      const old = new Date(now.getTime() - 40 * 24 * 3_600_000);
      const withBody = await setupMail(trx, { created_at: old, backfilled_at: now, body_text: "Body" });
      const fresh = await setupMail(trx, { created_at: now, backfilled_at: now, body_text: null });
      for (const one of [withBody, fresh]) {
        const llm = fakeLlm(analysis());
        expect(await triageOne(deps(trx, llm), one.ctx, one.mailbox, one.email)).toEqual({ kind: "triaged" });
        expect(llm.requests).toHaveLength(1);
      }
    });
  });

  test("at the daily cap the mail waits for the next quota day; no LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      await addLlmCalls(trx, ctx, mailbox.id, [dayStart, new Date(now.getTime() - 60_000)]);
      const llm = fakeLlm(analysis());

      expect(await triageOne(deps(trx, llm, 2), ctx, mailbox, email)).toEqual({
        kind: "capped",
        until: nextDayStart,
        dayStart,
      });
      expect(llm.requests).toHaveLength(0);
      const mail = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
      expect(mail.status).toBe("pending");
      expect(mail.next_attempt_at).toEqual(nextDayStart);
      expect(mail.attempts).toBe(0);
      expect(mail.locked_at).toBeNull();
    });
  });

  test("calls from before the quota day start do not count", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox } = await setupMail(trx);
      await addLlmCalls(trx, ctx, mailbox.id, [
        new Date(dayStart.getTime() - 1),
        new Date(dayStart.getTime() - 3_600_000),
      ]);
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm, 2), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(1);
    });
  });

  test("a blocklist mail is still triaged at the cap", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "bad@spam.test" }, [
        { pattern: "spam.test", kind: "blocklist" },
      ]);
      await addLlmCalls(trx, ctx, mailbox.id, [dayStart, dayStart]);
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm, 2), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
    });
  });
});

const OFFER_DAY = new Date("2026-11-10T16:00:00Z");

async function delegationSetup(
  trx: Transaction<DB>,
  opts: {
    mode?: TriageMailbox["mode"];
    createDraft?: boolean;
    rules?: TriageMailbox["rules"];
    mail?: Parameters<typeof insertTestEmail>[3];
  } = {}
) {
  const base = await setupMail(trx, { from_address: "jan@klient.test", ...opts.mail }, opts.rules ?? []);
  const delegateId = await insertDelegate(trx, base.ctx, { name: "Anna", email: "anna@firma.test", tags: ["offers"] });
  const mailbox: TriageMailbox = {
    ...base.mailbox,
    mode: opts.mode ?? "assist",
    toolSwitches: { ...base.mailbox.toolSwitches, create_draft: opts.createDraft ?? true },
    delegates: [{ id: delegateId, name: "Anna", email: "anna@firma.test", tags: ["offers"] }],
  };
  return { ...base, mailbox, delegateId };
}

const delegationAnswer = (delegateId: string | null, overrides: Record<string, unknown> = {}) =>
  analysis({
    category: "delegation",
    confidence: 0.95,
    reason_code: "direct_request",
    summary: null,
    fields: {
      due_date: "2026-11-10",
      language: "en",
      delegate_id: delegateId,
      task: "Prepare the offer",
      clarification: null,
    },
    ...overrides,
  });

function triageDeps(trx: Transaction<DB>, llm: LlmClient, clock: Date = now) {
  return { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap: 1000, now: () => clock };
}

async function dependsOn(trx: Transaction<DB>, actionId: string | undefined) {
  const row = await trx
    .selectFrom("actions")
    .select("depends_on_action_id")
    .where("id", "=", actionId ?? "")
    .executeTakeFirstOrThrow();
  return row.depends_on_action_id;
}

async function delegationRows(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("delegations").selectAll().where("email_id", "=", emailId).execute();
}

describe("triageOne: the delegation plan", () => {
  test("a delegation mail gets a ready draft, a send, a delegations row and delegation_id in both payloads", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx);
      const llm = fakeLlm(delegationAnswer(delegateId));
      expect(await triageOne(triageDeps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "triaged" });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      const draft = actions.find((a) => a.type === "create_draft");
      const send = actions.find((a) => a.type === "send");
      expect(actions).toHaveLength(2);
      const [delegation] = await delegationRows(trx, emailId);
      expect(delegation).toMatchObject({
        status: "drafted",
        delegate_id: delegateId,
        task_summary: "Prepare the offer",
        draft_action_id: draft?.id,
        send_action_id: send?.id,
      });
      expect(delegation?.due_at).toEqual(OFFER_DAY);
      expect(draft).toMatchObject({ status: "ready" });
      expect(draft?.payload).toEqual({
        kind: "delegation",
        delegate_id: delegateId,
        delegate_name: "Anna",
        to: ["anna@firma.test"],
        task: "Prepare the offer",
        due_date: "2026-11-10",
        language: "en",
        delegation_id: delegation?.id,
      });
      expect(send).toMatchObject({ status: "awaiting_approval" });
      expect(await dependsOn(trx, send?.id)).toBe(draft?.id ?? null);
      expect(send?.payload).toEqual({
        kind: "delegation",
        to: ["anna@firma.test"],
        delegate_id: delegateId,
        delegation_id: delegation?.id,
      });

      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "delegation.created")).toHaveLength(1);
      expect(log.find((r) => r.event === "email.triaged")?.data).toMatchObject({ delegation_id: delegation?.id });
    });
  });

  test("shadow mode logs both rows and creates no delegations row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx, { mode: "shadow" });
      await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(delegateId))), ctx, mailbox, email);

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["create_draft", "logged"],
        ["send", "logged"],
      ]);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
      expect(JSON.stringify(actions.map((a) => a.payload))).not.toContain("delegation_id");
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "delegation.created")).toHaveLength(0);
      expect(log.find((r) => r.event === "email.triaged")?.data).not.toHaveProperty("delegation_id");
    });
  });

  test("assist with the create_draft switch off logs both rows and creates no delegations row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx, { createDraft: false });
      await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(delegateId))), ctx, mailbox, email);

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["create_draft", "logged"],
        ["send", "logged"],
      ]);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a clarification answer gives the pair to the sender and no delegations row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await delegationSetup(trx);
      const answer = delegationAnswer(null, {
        fields: {
          due_date: null,
          language: "en",
          delegate_id: null,
          task: null,
          clarification: "Who should do this?",
        },
      });
      await triageOne(triageDeps(trx, fakeLlm(answer)), ctx, mailbox, email);

      const actions = await listActionsForEmail(trx, ctx, emailId);
      const draft = actions.find((a) => a.type === "create_draft");
      const send = actions.find((a) => a.type === "send");
      expect(draft?.payload).toMatchObject({ kind: "clarification", to: ["jan@klient.test"] });
      expect(send?.payload).toMatchObject({ kind: "clarification", to: ["jan@klient.test"] });
      expect(JSON.stringify([draft?.payload, send?.payload])).not.toContain("delegation_id");
      expect(await dependsOn(trx, send?.id)).toBe(draft?.id ?? null);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a delegation below the threshold plans the unsure move and no draft", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx);
      await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(delegateId, { confidence: 0.3 }))), ctx, mailbox, email);

      const [row] = await results(trx, emailId);
      expect(row?.category).toBe("unsure");
      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.payload])).toEqual([["move", { folder: "ai_manual" }]]);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("the classifier gets 6 categories and the delegates with delegates, 5 without", async () => {
    await withRollback(db, async (trx) => {
      const seen: { categories: string[]; delegates: boolean }[] = [];
      const recording: LlmClient = {
        modelOf: () => "fake-model",
        async generate(req) {
          const shape = (req.schema as unknown as { shape: { category: { options: string[] } } }).shape;
          seen.push({ categories: shape.category.options, delegates: req.prompt.includes("Anna") });
          return {
            data: req.schema.parse(analysis()()),
            usage: {
              role: req.role,
              promptVersion: req.promptVersion,
              model: "fake-model",
              tokensIn: 1,
              tokensOut: 1,
              latencyMs: 1,
            },
          };
        },
      } as LlmClient;
      const withDelegates = await delegationSetup(trx);
      await triageOne(triageDeps(trx, recording), withDelegates.ctx, withDelegates.mailbox, withDelegates.email);
      const without = await setupMail(trx);
      await triageOne(triageDeps(trx, recording), without.ctx, without.mailbox, without.email);

      expect(seen.map((s) => s.categories.length)).toEqual([6, 5]);
      expect(seen[0]?.categories).toContain("delegation");
      expect(seen[1]?.categories).not.toContain("delegation");
      expect(seen.map((s) => s.delegates)).toEqual([true, false]);
    });
  });
});

const REPLY_DELEGATE = "anna@firma.test";

// A delegation in `sent` for a mail of this mailbox; the sent Message-ID is `<m1>`.
async function sentDelegation(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, delegateId: string) {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, { status: "triaged" });
  const draftId = await insertAction(trx, ctx, emailId, { type: "create_draft", status: "applied" });
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: "applied",
    dependsOnActionId: draftId,
    approvedAt: new Date("2026-11-05T08:59:00Z"),
  });
  return insertDelegation(trx, ctx, {
    mailboxId,
    emailId,
    delegateId,
    draftActionId: draftId,
    sendActionId: sendId,
    status: "sent",
    sentMessageId: "<m1>",
  });
}

async function delegationStatus(trx: Transaction<DB>, id: string) {
  return trx
    .selectFrom("delegations")
    .select(["status", "answered_email_id"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function replySetup(
  trx: Transaction<DB>,
  opts: { from?: string; inReplyTo?: string; receivedAt?: Date; rules?: TriageMailbox["rules"]; status?: string } = {}
) {
  const base = await setupMail(
    trx,
    {
      from_address: opts.from ?? REPLY_DELEGATE,
      in_reply_to: opts.inReplyTo ?? "<m1>",
      ...(opts.receivedAt ? { received_at: opts.receivedAt } : {}),
    },
    opts.rules ?? []
  );
  const delegateId = await insertDelegate(trx, base.ctx, { name: "Anna", email: REPLY_DELEGATE });
  const delegationId = await sentDelegation(trx, base.ctx, base.mailbox.id, delegateId);
  if (opts.status) {
    await trx.updateTable("delegations").set({ status: opts.status }).where("id", "=", delegationId).execute();
  }
  return { ...base, delegateId, delegationId };
}

describe("triageOne: the reply rule", () => {
  test("a delegate's reply marks the delegation answered and the mail is triaged as any mail", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx);
      expect(await triageOne(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email)).toEqual({ kind: "triaged" });

      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "delegation.answered")).toHaveLength(1);
      expect(log.find((r) => r.event === "email.triaged")?.data).toMatchObject({
        answered_delegation_id: delegationId,
      });
      const [row] = await results(trx, emailId);
      expect(row?.category).toBe("info");
      expect((await listActionsForEmail(trx, ctx, emailId)).length).toBeGreaterThan(0);
    });
  });

  test("a safety block still marks the reply", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx);
      await triageOne(triageDeps(trx, fakeLlm(new LlmBlockedError("fake-model"))), ctx, mailbox, email);

      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "unsure", reason_code: "llm_blocked" });
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("finishTriageError still marks the reply", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx);
      await finishTriageError(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email);

      expect((await results(trx, emailId))[0]?.reason_code).toBe("triage_error");
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("a late reply (skipTooOld) still marks the delegation", async () => {
    await withRollback(db, async (trx) => {
      const received = new Date(now.getTime() - 8 * 24 * 3_600_000);
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx, { receivedAt: received });
      const llm = fakeLlm(analysis());
      expect(await triageOne(triageDeps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "skipped" });

      expect(llm.requests).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("skipped");
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("a blocklisted delegate's reply is spam and still marks the delegation", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegationId } = await replySetup(trx, {
        rules: [{ pattern: "firma.test", kind: "blocklist" }],
      });
      const llm = fakeLlm(analysis());
      await triageOne(triageDeps(trx, llm), ctx, mailbox, email);

      expect(llm.requests).toHaveLength(0);
      expect((await results(trx, emailId))[0]?.category).toBe("spam");
      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "answered", answered_email_id: emailId });
    });
  });

  test("a reply from another address changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox, delegationId } = await replySetup(trx, { from: "other@firma.test" });
      await triageOne(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email);

      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "sent", answered_email_id: null });
    });
  });

  test("a reply to a done delegation changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox, delegationId } = await replySetup(trx, { status: "done" });
      await triageOne(triageDeps(trx, fakeLlm(analysis())), ctx, mailbox, email);

      expect(await delegationStatus(trx, delegationId)).toEqual({ status: "done", answered_email_id: null });
    });
  });

  test("a lost claim writes no delegations row and no answered", async () => {
    await withRollback(db, async (trx) => {
      const reply = await replySetup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + 60_000) })
        .where("id", "=", reply.emailId)
        .execute();
      expect(await saveTriage(trx, reply.ctx, reply.mailbox, reply.email, decision(), now)).toEqual({ kind: "lost" });
      expect(await delegationStatus(trx, reply.delegationId)).toEqual({ status: "sent", answered_email_id: null });

      const mail = await delegationSetup(trx);
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + 60_000) })
        .where("id", "=", mail.emailId)
        .execute();
      const planned = decision({
        finalCategory: "delegation",
        modelCategory: "delegation",
        delegation: {
          delegateId: mail.delegateId,
          delegateName: "Anna",
          to: "anna@firma.test",
          task: "Prepare the offer",
          clarification: null,
          dueDate: null,
          language: "en",
          senderAddress: "jan@klient.test",
        },
      });
      expect(await saveTriage(trx, mail.ctx, mail.mailbox, mail.email, planned, now)).toEqual({ kind: "lost" });
      expect(await delegationRows(trx, mail.emailId)).toHaveLength(0);
      expect(await listActionsForEmail(trx, mail.ctx, mail.emailId)).toHaveLength(0);
    });
  });

  test("changed settings: no delegations row, no answered; the next run does both", async () => {
    await withRollback(db, async (trx) => {
      const mail = await delegationSetup(trx);
      const reply = await replySetup(trx);
      // Both mails belong to one mailbox each; make the settings of each stale.
      for (const mailboxId of [mail.mailbox.id, reply.mailbox.id]) {
        await trx
          .updateTable("mailbox_settings")
          .set({ updated_at: new Date(now.getTime() + 60_000) })
          .where("mailbox_id", "=", mailboxId)
          .execute();
      }

      expect(
        await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(mail.delegateId))), mail.ctx, mail.mailbox, mail.email)
      ).toEqual({ kind: "settings_changed" });
      expect(await triageOne(triageDeps(trx, fakeLlm(analysis())), reply.ctx, reply.mailbox, reply.email)).toEqual({
        kind: "settings_changed",
      });
      expect(await delegationRows(trx, mail.emailId)).toHaveLength(0);
      expect(await delegationStatus(trx, reply.delegationId)).toEqual({ status: "sent", answered_email_id: null });
      expect(await emailStatus(trx, mail.emailId)).toBe("pending");
      expect(await emailStatus(trx, reply.emailId)).toBe("pending");

      const clock = new Date(now.getTime() + 120_000);
      const claimed = await claimEmails(trx, mail.ctx, mail.mailbox.id, {
        now: clock,
        limit: 10,
        staleBefore: new Date(clock.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      const mailAgain = claimed.find((row) => row.id === mail.emailId);
      const claimedReply = await claimEmails(trx, reply.ctx, reply.mailbox.id, {
        now: clock,
        limit: 10,
        staleBefore: new Date(clock.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      const replyAgain = claimedReply.find((row) => row.id === reply.emailId);
      if (!mailAgain || !replyAgain) throw new Error("claim failed");
      const fresh = async (mailbox: TriageMailbox, ctx: TenantContext) => ({
        ...mailbox,
        settingsVersion: (await getMailboxSettings(trx, ctx, mailbox.id))?.version ?? "",
      });
      await triageOne(
        triageDeps(trx, fakeLlm(delegationAnswer(mail.delegateId)), clock),
        mail.ctx,
        await fresh(mail.mailbox, mail.ctx),
        mailAgain
      );
      await triageOne(
        triageDeps(trx, fakeLlm(analysis()), clock),
        reply.ctx,
        await fresh(reply.mailbox, reply.ctx),
        replyAgain
      );
      expect(await delegationRows(trx, mail.emailId)).toHaveLength(1);
      expect(await delegationStatus(trx, reply.delegationId)).toEqual({
        status: "answered",
        answered_email_id: reply.emailId,
      });
    });
  });
});

describe("triageOne: the plan by the source folder (D11)", () => {
  const JUNK = "Wiadomości-śmieci";
  const folders = [
    { key: "offers", path: "Oferty", role: "sort" },
    { key: "junk", path: JUNK, role: "junk" },
  ] as const;

  async function folderSetup(
    trx: Transaction<DB>,
    opts: {
      sourceFolder: string;
      from?: string;
      rules?: TriageMailbox["rules"];
      auto?: readonly Category[];
      junkRow?: boolean;
      createDraft?: boolean;
    }
  ) {
    const base = await setupMail(
      trx,
      { from_address: opts.from ?? "jan@klient.test", source_folder: opts.sourceFolder },
      opts.rules ?? []
    );
    const delegateId = await insertDelegate(trx, base.ctx, {
      name: "Anna",
      email: "anna@firma.test",
      tags: ["offers"],
    });
    if (opts.junkRow !== false) await ensureSyncFolders(trx, base.ctx, base.mailbox.id, folders, now);
    const mailbox: TriageMailbox = {
      ...base.mailbox,
      mode: "assist",
      toolSwitches: {
        move: true,
        mark_read: true,
        flag: true,
        create_draft: opts.createDraft ?? false,
        move_unsure: false,
      },
      policy: Object.fromEntries((opts.auto ?? []).map((category) => [category, { auto: true }])),
      delegates: [{ id: delegateId, name: "Anna", email: "anna@firma.test", tags: ["offers"] }],
      junkFolder: opts.junkRow === false ? null : await getJunkFolderPath(trx, base.ctx, base.mailbox.id),
      resumedAt: null,
    };
    return { ...base, mailbox, delegateId };
  }

  async function run(
    trx: Transaction<DB>,
    setup: Awaited<ReturnType<typeof folderSetup>>,
    category: string,
    overrides: Record<string, unknown> = {}
  ) {
    const llm = fakeLlm(analysis({ category, ...overrides }));
    const outcome = await triageOne(triageDeps(trx, llm), setup.ctx, setup.mailbox, setup.email);
    expect(outcome).toEqual({ kind: "triaged" });
    const actions = await listActionsForEmail(trx, setup.ctx, setup.emailId);
    return { llm, actions };
  }

  const types = (actions: { type: string }[]) => actions.map((a) => a.type).sort();

  test("1. spam folder mail, LLM spam: triaged, no actions row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      const { actions } = await run(trx, s, "spam");
      expect(await emailStatus(trx, s.emailId)).toBe("triaged");
      expect(actions).toHaveLength(0);
    });
  });

  test("2. spam folder mail from a blocklisted sender: spam, no LLM call, no actions row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, {
        sourceFolder: JUNK,
        from: "bad@spam.test",
        rules: [{ pattern: "spam.test", kind: "blocklist" }],
      });
      const { llm, actions } = await run(trx, s, "info");
      expect(llm.requests).toHaveLength(0);
      const [row] = await results(trx, s.emailId);
      expect(row).toMatchObject({ category: "spam", reason_code: "blocklist" });
      expect(actions).toHaveLength(0);
    });
  });

  test("3. spam folder mail, urgent, auto off: one logged move to inbox, no flag", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      const { actions } = await run(trx, s, "urgent");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "move", status: "logged", payload: { folder: "inbox" } });
    });
  });

  test("4. spam folder mail, urgent, auto on: the move to inbox is ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK, auto: ["urgent"] });
      const { actions } = await run(trx, s, "urgent");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "move", status: "ready", payload: { folder: "inbox" } });
    });
  });

  test("5. spam folder mail, info: save_summary ready, move ai_info logged", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      const { actions } = await run(trx, s, "info");
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["move", "logged"],
        ["save_summary", "ready"],
      ]);
      expect(actions.find((a) => a.type === "move")?.payload).toEqual({ folder: "ai_info" });
    });
  });

  test("6. spam folder mail from a VIP, notification: mark_read and move ai_notifications logged", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, {
        sourceFolder: JUNK,
        from: "boss@firma.test",
        rules: [{ pattern: "boss@firma.test", kind: "vip" }],
        auto: ["notification"],
      });
      const { actions } = await run(trx, s, "notification");
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["mark_read", "logged"],
        ["move", "logged"],
      ]);
      expect(actions.find((a) => a.type === "move")?.payload).toEqual({ folder: "ai_notifications" });
    });
  });

  test("7. spam folder mail, delegation: one logged move to inbox, no draft, send or delegations row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK, createDraft: true });
      const { actions } = await run(trx, s, "delegation", {
        confidence: 0.95,
        reason_code: "direct_request",
        summary: null,
        fields: {
          due_date: "2026-11-10",
          language: "en",
          delegate_id: s.delegateId,
          task: "Prepare the offer",
          clarification: null,
        },
      });
      expect(types(actions)).toEqual(["move"]);
      expect(actions[0]).toMatchObject({ status: "logged", payload: { folder: "inbox" } });
      expect(await delegationRows(trx, s.emailId)).toHaveLength(0);
    });
  });

  test("8. sort folder mail is planned as INBOX mail: needs_reply no action, urgent flag ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: "Oferty" });
      expect((await run(trx, s, "needs_reply")).actions).toHaveLength(0);
    });
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: "Oferty" });
      const { actions } = await run(trx, s, "urgent");
      expect(actions.map((a) => [a.type, a.status])).toEqual([["flag", "ready"]]);
    });
  });

  test("9. sort folder mail, notification, auto on: mark_read and move ai_notifications ready", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: "Oferty", auto: ["notification"] });
      const { actions } = await run(trx, s, "notification");
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["mark_read", "ready"],
        ["move", "ready"],
      ]);
      expect(actions.find((a) => a.type === "move")?.payload).toEqual({ folder: "ai_notifications" });
    });
  });

  test("10. a disabled junk row gives the same plan; no junk row gives the plan of today", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK });
      await trx
        .updateTable("mailbox_folders")
        .set({ enabled: false })
        .where("mailbox_id", "=", s.mailbox.id)
        .where("role", "=", "junk")
        .execute();
      // The snapshot is read after the change.
      const mailbox = { ...s.mailbox, junkFolder: await getJunkFolderPath(trx, s.ctx, s.mailbox.id) };
      expect(mailbox.junkFolder).toBe(JUNK);
      const outcome = await triageOne(
        triageDeps(trx, fakeLlm(analysis({ category: "urgent" }))),
        s.ctx,
        mailbox,
        s.email
      );
      expect(outcome).toEqual({ kind: "triaged" });
      const actions = await listActionsForEmail(trx, s.ctx, s.emailId);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ type: "move", status: "logged", payload: { folder: "inbox" } });
    });
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { sourceFolder: JUNK, junkRow: false });
      const { actions } = await run(trx, s, "urgent");
      expect(actions.map((a) => [a.type, a.status])).toEqual([["flag", "ready"]]);
    });
  });
});
