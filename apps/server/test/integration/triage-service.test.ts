import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { countLlmCallsSince } from "../../src/modules/audit";
import { claimEmails, type ClaimedEmail } from "../../src/modules/mail";
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

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-05T12:00:00.123Z");

async function setup(trx: Transaction<DB>) {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
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
    mode: "shadow",
    toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
    policy: { info: { auto: true } },
    rules: [],
    movesSupported: true,
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
    usage: { model: "m", tokensIn: 120, tokensOut: 30, latencyMs: 850 },
    auditReasonCode: "newsletter",
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
      expect(await saveTriage(trx, ctx, mailbox, email, decision())).toEqual({ kind: "triaged" });
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
      expect(await saveTriage(trx, ctx, mailbox, email, below)).toEqual({ kind: "triaged" });

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
      await saveTriage(trx, ctx, mailbox, email, decision({ usage: null, modelCategory: null, model: null }));
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
      expect(await saveTriage(trx, ctx, mailbox, email, decision())).toEqual({ kind: "lost" });
      expect(await results(trx, emailId)).toHaveLength(0);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(0);
      expect(await audit(trx, emailId)).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("processing");
    });
  });

  test("a second save creates a second result but no second set of actions", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setup(trx);
      await saveTriage(trx, ctx, mailbox, email, decision());
      await trx.updateTable("emails").set({ status: "pending" }).where("id", "=", emailId).execute();
      const [again]: ClaimedEmail[] = await claimEmails(trx, ctx, mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * 60_000),
        syntheticOnly: false,
      });
      if (!again) throw new Error("second claim failed");
      expect(await saveTriage(trx, ctx, mailbox, again, decision())).toEqual({ kind: "triaged" });

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
    classifierModel: "fake-model",
    requests,
    async classify(req) {
      requests.push({ system: req.system, prompt: req.prompt });
      if (answer instanceof Error) throw answer;
      return {
        data: req.schema.parse(answer()),
        usage: { model: "fake-model", tokensIn: 100, tokensOut: 20, latencyMs: 300 },
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
    fields: { due_date: null, language: "pl" },
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
  syntheticOnly = false
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
      expect(await triageOne({ db: trx, llm, pause: fakePause(), now: () => now }, ctx, mailbox, email)).toEqual({
        kind: "triaged",
      });

      expect(llm.requests).toHaveLength(1);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({
        category: "info",
        reason_code: "newsletter",
        model: "fake-model",
        prompt_version: "classifier-v1",
        tokens_in: 100,
        tokens_out: 20,
      });
      const calls = await llmRows(trx, emailId);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.reason_code).toBe("ok");
      expect(calls[0]?.data).toEqual({
        mailbox_id: mailbox.id,
        model: "fake-model",
        prompt_version: "classifier-v1",
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
      expect(await triageOne({ db: trx, llm, pause: fakePause(), now: () => now }, ctx, mailbox, email)).toEqual({
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
      await triageOne({ db: trx, llm, pause: fakePause(), now: () => now }, ctx, mailbox, email);

      expect(llm.requests).toHaveLength(1);
      const system = llm.requests[0]?.system ?? "";
      const other = fakeLlm(analysis());
      const plain = await setupMail(trx, { from_address: "someone@else.test" });
      await triageOne(
        { db: trx, llm: other, pause: fakePause(), now: () => now },
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
      await triageOne({ db: trx, llm, pause: fakePause(), now: () => now }, ctx, mailbox, email);

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
      const outcome = await triageOne({ db: trx, llm, pause, now: () => now }, ctx, mailbox, email);

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
      expect(calls[0]?.data).toMatchObject({ model: "fake-model", tokens_in: null, tokens_out: null });
    });
  });

  test("a config error pauses with the config kind and counts nothing", async () => {
    for (const code of ["http_404", "http_400_key"] as const) {
      await withRollback(db, async (trx) => {
        const { ctx, emailId, email, mailbox } = await setupMail(trx);
        const llm = fakeLlm(new LlmConfigError(code, "fake-model"));
        const pause = fakePause();
        const outcome = await triageOne({ db: trx, llm, pause, now: () => now }, ctx, mailbox, email);

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
      const outcome = await triageOne({ db: trx, llm, pause, now: () => now }, ctx, mailbox, email);

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
    });
  });

  test("finishTriageError saves unsure with the triage_error code", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const deps = { db: trx, llm: fakeLlm(analysis()), pause: fakePause(), now: () => now };
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
          const outcome = await triageOne({ db: trx, llm, pause, now: () => clock }, ctx, mailbox, email);
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
          { db: trx, llm: fakeLlm(error), pause: fakePause(), now: () => now },
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
        { db: trx, llm: fakeLlm(new LlmSoftError("http_429", "fake-model")), pause, now: () => now },
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
        { db: trx, llm: fakeLlm(analysis()), pause, now: () => clock },
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
        const outcome = await triageOne({ db: failing, llm, pause, now: () => now }, ctx, mailbox, email);

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
      await triageOne({ db: trx, llm, pause: fakePause(), now: () => now }, base.ctx, base.mailbox, email);

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
        syntheticOnly: true,
      });
      const email = claimed.find((row) => row.id === currentId);
      if (!email) throw new Error("claim failed");
      const llm = fakeLlm(analysis());
      await triageOne({ db: trx, llm, pause: fakePause(), now: () => now }, base.ctx, base.mailbox, email);

      const prompt = llm.requests[0]?.prompt ?? "";
      expect(prompt).not.toContain("REAL-MARKER-XYZ");
      expect(prompt).toContain("SYNTH-MARKER-ABC");
    });
  });
});
