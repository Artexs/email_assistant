import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createLlmPause, createTriageJob, triageOne, noGateEvidence } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { LlmConfigError, LlmSoftError, type LlmClient } from "../../src/platform/llm";

import { insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { now, minutesFromNow, fakeLlm, mailboxWithSettings, emailRow } from "./triage-job-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("createTriageJob: pause and errors", () => {
  function logLines(text: string): string[] {
    return errorSpy.mock.calls.map((call: unknown[]) => String(call[1])).filter((line: string) => line.includes(text));
  }

  // A fake LLM that throws `failWith` while it is set.
  function flakyLlm() {
    const llm = fakeLlm();
    const state: { failWith: Error | null } = { failWith: null };
    const inner = llm.generate.bind(llm);
    llm.generate = (async (req) => {
      if (state.failWith !== null) {
        llm.prompts.push(req.prompt);
        throw state.failWith;
      }
      return inner(req);
    }) as LlmClient["generate"];
    return { llm, state };
  }

  function clockJob(trx: Transaction<DB>, llm: LlmClient, clock: { at: Date }, overrides?: object) {
    return createTriageJob({
      runningKey: noGateEvidence.runningKey,
      db: trx,
      llm,
      pause: createLlmPause(),
      scope: { kind: "synthetic", testMail: NO_TEST_SENDERS },
      batchSize: 5,
      testMail: NO_TEST_SENDERS,
      dailyCap: 1000,
      junkDailyCap: 1000,
      now: () => clock.at,
      ...overrides,
    });
  }

  async function threeMails(
    trx: Transaction<DB>,
    ctx: TenantContext,
    mailboxId: string
  ): Promise<[string, string, string]> {
    const ids: string[] = [];
    for (const minutes of [-30, -20, -10]) {
      ids.push(
        await insertTestEmail(trx, ctx, mailboxId, {
          message_id_header: `<m${minutes}@ea-seed.test>`,
          received_at: minutesFromNow(minutes),
        })
      );
    }
    return ids as [string, string, string];
  }

  async function fullRow(trx: Transaction<DB>, id: string) {
    return trx
      .selectFrom("emails")
      .select(["status", "attempts", "next_attempt_at", "locked_at"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }

  test("a soft error on the first mail stops the run; untried mail keeps its old time; the pause grows and resets", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const [first, second, third] = await threeMails(trx, ctx, mailboxId);
      const { llm, state } = flakyLlm();
      const clock = { at: now };
      state.failWith = new LlmSoftError("http_503", "fake-model");
      const triage = clockJob(trx, llm, clock);

      await triage.run();
      expect(llm.prompts).toHaveLength(1);
      expect(await fullRow(trx, first)).toEqual({
        status: "pending",
        attempts: 0,
        next_attempt_at: minutesFromNow(5),
        locked_at: null,
      });
      for (const id of [second, third]) {
        expect(await fullRow(trx, id)).toEqual({
          status: "pending",
          attempts: 0,
          next_attempt_at: null,
          locked_at: null,
        });
      }
      expect(logLines("llm_paused ")).toHaveLength(1);

      clock.at = minutesFromNow(1);
      await triage.run();
      expect(llm.prompts).toHaveLength(1);
      expect(logLines("llm_paused ")).toHaveLength(1);
      for (const id of [first, second, third]) {
        const row = await fullRow(trx, id);
        expect(row.status).toBe("pending");
        expect(row.locked_at).toBeNull();
      }

      clock.at = minutesFromNow(6);
      await triage.run();
      expect(llm.prompts).toHaveLength(2);
      const warns = logLines("llm_paused ");
      expect(warns).toHaveLength(2);
      expect(warns[1]).toContain(" wait_ms=600000 ");

      state.failWith = null;
      clock.at = minutesFromNow(17);
      await triage.run();
      for (const id of [first, second, third]) expect((await emailRow(trx, id)).status).toBe("triaged");

      state.failWith = new LlmSoftError("http_503", "fake-model");
      const later = await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<later@ea-seed.test>" });
      clock.at = minutesFromNow(18);
      await triage.run();
      expect((await emailRow(trx, later)).status).toBe("pending");
      expect(logLines("llm_paused ")[2]).toContain(" wait_ms=300000 ");
    });
  });

  test("a network error pauses the client; the mail stays pending without a count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const [first] = await threeMails(trx, ctx, mailboxId);
      const { llm, state } = flakyLlm();
      state.failWith = new LlmSoftError("network", "fake-model");
      const triage = clockJob(trx, llm, { at: now });

      await triage.run();
      expect(llm.prompts).toHaveLength(1);
      expect(await fullRow(trx, first)).toEqual({
        status: "pending",
        attempts: 0,
        next_attempt_at: minutesFromNow(5),
        locked_at: null,
      });
      expect(logLines("llm_paused code=network ")).toHaveLength(1);
    });
  });

  test("a config error logs one error line and leaves the mails pending without a count", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const ids = await threeMails(trx, ctx, mailboxId);
      const { llm, state } = flakyLlm();
      state.failWith = new LlmConfigError("http_403", "fake-model");

      await clockJob(trx, llm, { at: now }).run();

      expect(llm.prompts).toHaveLength(1);
      const configLines = logLines("llm_config_paused ");
      expect(configLines).toHaveLength(1);
      expect(configLines[0]).toMatch(/^llm_config_paused code=http_403 wait_ms=300000 until=\S+$/);
      for (const hint of ["API_KEY", "MODEL_CLASSIFIER", "project", "billing"])
        expect(configLines[0]).not.toContain(hint);
      expect(logLines("_failed")).toHaveLength(0);
      for (const id of ids) expect(await emailRow(trx, id)).toEqual({ status: "pending", attempts: 0 });
    });
  });

  test("5 soft-error rounds leave the mails pending with no count and no result row", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const ids = await threeMails(trx, ctx, mailboxId);
      const { llm, state } = flakyLlm();
      state.failWith = new LlmSoftError("http_429", "fake-model");
      const clock = { at: now };
      const triage = clockJob(trx, llm, clock);

      for (let round = 0; round < 5; round += 1) {
        await triage.run();
        clock.at = new Date(clock.at.getTime() + 61 * MINUTE_MS);
      }

      expect(llm.prompts).toHaveLength(5);
      for (const id of ids) expect(await emailRow(trx, id)).toEqual({ status: "pending", attempts: 0 });
      const results = await trx.selectFrom("triage_results").select("id").where("email_id", "in", ids).execute();
      expect(results).toHaveLength(0);
    });
  });

  test("a settings parse error stops that mailbox only; the other mailbox is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const broken = await mailboxWithSettings(trx);
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ move: "yes" }) })
        .where("mailbox_id", "=", broken.mailboxId)
        .execute();
      const brokenMail = await insertTestEmail(trx, broken.ctx, broken.mailboxId, {
        message_id_header: "<b@ea-seed.test>",
      });
      const ready = await mailboxWithSettings(trx);
      const readyMail = await insertTestEmail(trx, ready.ctx, ready.mailboxId, {
        message_id_header: "<r@ea-seed.test>",
      });

      const llm = fakeLlm();
      await clockJob(trx, llm, { at: now }).run();

      const lines = logLines("triage_mailbox_failed");
      expect(lines).toEqual([
        `triage_mailbox_failed org_id=${broken.orgId} mailbox_id=${broken.mailboxId} error=ZodError`,
      ]);
      expect(await emailRow(trx, brokenMail)).toEqual({ status: "pending", attempts: 0 });
      expect((await emailRow(trx, readyMail)).status).toBe("triaged");
    });
  });

  test("an unexpected error on mail 1 counts a try, releases mail 2 and 3 untouched and never throws", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const [first, second, third] = await threeMails(trx, ctx, mailboxId);
      const llm = fakeLlm();
      let calls = 0;
      const triage = clockJob(
        trx,
        llm,
        { at: now },
        {
          triageOne: async () => {
            calls += 1;
            throw new Error("MARKER-ERR");
          },
        }
      );

      await triage.run();

      expect(calls).toBe(1);
      expect(await fullRow(trx, first)).toEqual({
        status: "pending",
        attempts: 1,
        next_attempt_at: minutesFromNow(5),
        locked_at: null,
      });
      for (const id of [second, third]) {
        expect(await fullRow(trx, id)).toEqual({
          status: "pending",
          attempts: 0,
          next_attempt_at: null,
          locked_at: null,
        });
      }
      const lines = logLines("triage_mailbox_failed");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(" error=Error");
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("MARKER-ERR");
    });
  });

  test("changed settings on mail 1: mail 2 and 3 go back untouched with no LLM call", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const [, second, third] = await threeMails(trx, ctx, mailboxId);
      const llm = fakeLlm();
      let calls = 0;
      await clockJob(
        trx,
        llm,
        { at: now },
        {
          triageOne: async () => {
            calls += 1;
            return { kind: "settings_changed" };
          },
        }
      ).run();

      expect(calls).toBe(1);
      expect(llm.prompts).toHaveLength(0);
      for (const id of [second, third]) {
        expect(await fullRow(trx, id)).toEqual({
          status: "pending",
          attempts: 0,
          next_attempt_at: null,
          locked_at: null,
        });
      }
    });
  });

  test("an unexpected error on a mail at its last try ends as triage_error", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const mail = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<last@ea-seed.test>",
        attempts: 2,
      });
      const triage = clockJob(
        trx,
        fakeLlm(),
        { at: now },
        {
          triageOne: async () => {
            throw new Error("MARKER-ERR");
          },
        }
      );

      await triage.run();

      expect((await emailRow(trx, mail)).status).toBe("triaged");
      const result = await trx
        .selectFrom("triage_results")
        .select(["category", "reason_code"])
        .where("email_id", "=", mail)
        .execute();
      expect(result).toEqual([{ category: "unsure", reason_code: "triage_error" }]);
      const audit = await trx
        .selectFrom("audit_log")
        .select("reason_code")
        .where("email_id", "=", mail)
        .where("event", "=", "email.triaged")
        .execute();
      expect(audit).toEqual([{ reason_code: "triage_error" }]);
    });
  });

  test("a soft error in mailbox A gives no LLM call for mailbox B in the same run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await mailboxWithSettings(trx);
      const b = await mailboxWithSettings(trx);
      const mailA = await insertTestEmail(trx, a.ctx, a.mailboxId, { message_id_header: "<a@ea-seed.test>" });
      const mailB = await insertTestEmail(trx, b.ctx, b.mailboxId, { message_id_header: "<b@ea-seed.test>" });
      const { llm, state } = flakyLlm();
      state.failWith = new LlmSoftError("http_503", "fake-model");

      await clockJob(trx, llm, { at: now }).run();

      // listSyncTargets order is random: either mailbox can be the one that gets the soft error
      expect(llm.prompts).toHaveLength(1);
      const rows = [await fullRow(trx, mailA), await fullRow(trx, mailB)];
      const paused = { status: "pending", attempts: 0, next_attempt_at: minutesFromNow(5), locked_at: null };
      const untouched = { status: "pending", attempts: 0, next_attempt_at: null, locked_at: null };
      expect(rows).toContainEqual(paused);
      expect(rows).toContainEqual(untouched);
    });
  });

  test("when the triage_error save fails too, the mail at its last try goes back with a counted try", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const mail = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<last@ea-seed.test>",
        attempts: 2,
      });
      // The first `updateTable("emails")` after the arm throws: this is `finishEmail` of the save.
      let armed = false;
      const failingDb = new Proxy(trx, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          if (prop === "updateTable") {
            return (table: string) => {
              if (armed) {
                armed = false;
                throw new Error("MARKER-SAVE");
              }
              return (value as (t: string) => unknown).call(target, table);
            };
          }
          return value.bind(target);
        },
      });
      const triage = clockJob(
        trx,
        fakeLlm(),
        { at: now },
        {
          db: failingDb,
          triageOne: async () => {
            armed = true;
            throw new Error("MARKER-ERR");
          },
        }
      );

      await triage.run();

      expect(await fullRow(trx, mail)).toEqual({
        status: "pending",
        attempts: 3,
        next_attempt_at: minutesFromNow(5),
        locked_at: null,
      });
      expect(logLines("triage_error_save_failed")).toHaveLength(1);
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("MARKER-");
    });
  });

  test("a soft error whose release fails does not end a mail at its last try as triage_error", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const mail = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<last@ea-seed.test>",
        attempts: 2,
      });
      // The first `updateTable("emails")` after the arm throws: this is the `releaseEmail` of the soft error.
      let armed = false;
      const failingDb = new Proxy(trx, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== "function") return value;
          if (prop === "updateTable") {
            return (table: string) => {
              if (armed) {
                armed = false;
                throw new Error("MARKER-RELEASE");
              }
              return (value as (t: string) => unknown).call(target, table);
            };
          }
          return value.bind(target);
        },
      });
      const { llm, state } = flakyLlm();
      state.failWith = new LlmSoftError("http_503", "fake-model");
      const triage = clockJob(
        trx,
        llm,
        { at: now },
        {
          db: failingDb,
          triageOne: async (...args: Parameters<typeof triageOne>) => {
            armed = true;
            return triageOne(...args);
          },
        }
      );

      await triage.run();

      expect(llm.prompts).toHaveLength(1);
      const row = await emailRow(trx, mail);
      expect(row.status).not.toBe("triaged");
      expect(row.attempts).toBe(2);
      const results = await trx.selectFrom("triage_results").select("id").where("email_id", "=", mail).execute();
      expect(results).toHaveLength(0);
      expect(logLines("triage_error_save_failed")).toHaveLength(0);
      expect(logLines("triage_mailbox_failed")).toHaveLength(1);
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("MARKER-");
    });
  });

  test("a paused client at the start of run() claims nothing and logs nothing", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const [first] = await threeMails(trx, ctx, mailboxId);
      const pause = createLlmPause();
      pause.trip("soft", "http_503", now);
      errorSpy.mockClear();
      const llm = fakeLlm();

      await clockJob(trx, llm, { at: minutesFromNow(1) }, { pause, triageOne }).run();

      expect(llm.prompts).toHaveLength(0);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(await fullRow(trx, first)).toEqual({
        status: "pending",
        attempts: 0,
        next_attempt_at: null,
        locked_at: null,
      });
    });
  });
});
