import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";

import { countLlmCallsSince } from "../../src/modules/audit";
import { claimEmails } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { finishTriageError, triageOne } from "../../src/modules/triage";
import { LlmBlockedError, LlmConfigError, LlmHardError, LlmOutputError, LlmSoftError } from "../../src/platform/llm";

import { testDb, withRollback } from "./helpers";
import {
  now,
  results,
  audit,
  emailStatus,
  fakeLlm,
  analysis,
  fakePause,
  setupMail,
  llmRows,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("triageOne", () => {
  test("a soft error pauses, releases the mail without a count and writes no result", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = fakeLlm(new LlmSoftError("http_429", "fake-model"));
      const pause = fakePause();
      const outcome = await triageOne(
        { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );

      const until = new Date(now.getTime() + 5 * MINUTE_MS);
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
          { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => now },
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
        { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => now },
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
        junkDailyCap: 1000,
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
            { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => clock },
            ctx,
            mailbox,
            email
          );
          if (run < 3) {
            expect(outcome).toEqual({ kind: "retry_later" });
            const mail = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
            attemptsAfter.push(mail.attempts);
            expect(mail.status).toBe("pending");
            expect(mail.next_attempt_at).toEqual(new Date(clock.getTime() + 5 * MINUTE_MS));
            clock = new Date(clock.getTime() + 6 * MINUTE_MS);
            const claimed = await claimEmails(trx, ctx, mailbox.id, {
              now: clock,
              limit: 10,
              staleBefore: new Date(clock.getTime() - 5 * MINUTE_MS),
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
        expect(await countLlmCallsSince(trx, ctx, mailbox.id, new Date(now.getTime() - MINUTE_MS))).toBe(3);
      });
    }
  });

  test("a lost claim on release returns lost in the soft path and in the hard-retry path", async () => {
    for (const error of [new LlmSoftError("http_429", "fake-model"), new LlmHardError("http_400", "fake-model")]) {
      await withRollback(db, async (trx) => {
        const { ctx, emailId, email, mailbox } = await setupMail(trx);
        await trx
          .updateTable("emails")
          .set({ locked_at: new Date(now.getTime() + MINUTE_MS) })
          .where("id", "=", emailId)
          .execute();
        const outcome = await triageOne(
          {
            db: trx,
            llm: fakeLlm(error),
            pause: fakePause(),
            testMail: NO_TEST_SENDERS,
            dailyCap: 1000,
            junkDailyCap: 1000,
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
          junkDailyCap: 1000,
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
        staleBefore: new Date(clock.getTime() - 5 * MINUTE_MS),
        syntheticOnly: false,
      });
      const again = claimed.find((row) => row.id === emailId);
      if (!again) throw new Error("claim failed");

      const outcome = await triageOne(
        {
          db: trx,
          llm: fakeLlm(analysis()),
          pause,
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => clock,
        },
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
          { db: failing, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => now },
          ctx,
          mailbox,
          email
        );

        expect(outcome.kind).toBe("paused");
        expect(pause.trips).toEqual([{ kind: "soft", code: "http_503" }]);
        expect(await llmRows(trx, emailId)).toHaveLength(0);
        const lines = warnSpy.mock.calls.map((call) => String(call[1]));
        expect(lines).toContain(
          `llm_audit_failed org_id=${ctx.orgId} mailbox_id=${mailbox.id} email_id=${emailId} error=Error`
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
