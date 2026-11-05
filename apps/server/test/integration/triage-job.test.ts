import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertDefaultSettings } from "../../src/modules/config";
import { createLlmPause, createTriageJob, triageOne, type TriageScope } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { LlmConfigError, LlmSoftError, type LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-05T12:00:00.123Z");

function minutesFromNow(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

interface FakeLlm extends LlmClient {
  prompts: string[];
}

function fakeLlm(): FakeLlm {
  const prompts: string[] = [];
  return {
    classifierModel: "fake-model",
    prompts,
    async classify(req) {
      prompts.push(req.prompt);
      return {
        data: req.schema.parse({
          category: "info",
          confidence: 0.9,
          reason_code: "newsletter",
          reason: "a newsletter",
          summary: "short summary",
          fields: { due_date: null, language: "pl" },
        }),
        usage: { model: "fake-model", tokensIn: 100, tokensOut: 20, latencyMs: 300 },
      };
    },
  } as FakeLlm;
}

function job(trx: Transaction<DB>, llm: LlmClient, scope: TriageScope) {
  return createTriageJob({
    db: trx,
    llm,
    pause: createLlmPause(),
    scope,
    batchSize: 5,
    dailyCap: 1000,
    now: () => now,
  });
}

async function mailboxWithSettings(trx: Transaction<DB>, opts?: { address?: string }) {
  const created = await createOrgWithMailbox(trx, opts);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  return { ...created, ctx };
}

async function emailRow(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("emails").select(["status", "attempts"]).where("id", "=", id).executeTakeFirstOrThrow();
}

describe("createTriageJob", () => {
  test("one run triages all pending mails, oldest first", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const newest = await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-10), subject: "third" });
      const oldest = await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-30), subject: "first" });
      const middle = await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-20),
        subject: "second",
      });

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all", mailboxAddress: await addressOf(trx, mailboxId) }).run();

      expect(llm.prompts).toHaveLength(3);
      expect(llm.prompts[0]).toContain("first");
      expect(llm.prompts[1]).toContain("second");
      expect(llm.prompts[2]).toContain("third");
      for (const id of [oldest, middle, newest]) expect((await emailRow(trx, id)).status).toBe("triaged");
    });
  });

  test("scope all: only the mailbox with the scope address (any case) is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const own = await mailboxWithSettings(trx, { address: "Boss@Scope.test" });
      const other = await mailboxWithSettings(trx, { address: "other@scope.test" });
      const ownMail = await insertTestEmail(trx, own.ctx, own.mailboxId);
      const otherMail = await insertTestEmail(trx, other.ctx, other.mailboxId);

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all", mailboxAddress: " boss@scope.TEST " }).run();

      expect(llm.prompts).toHaveLength(1);
      expect((await emailRow(trx, ownMail)).status).toBe("triaged");
      expect((await emailRow(trx, otherMail)).status).toBe("pending");
    });
  });

  test("scope synthetic: only @ea-seed.test> mail is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const real = await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<r@x.test>" });
      const seeded = await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<s@ea-seed.test>" });

      const llm = fakeLlm();
      await job(trx, llm, { kind: "synthetic" }).run();

      expect(llm.prompts).toHaveLength(1);
      expect((await emailRow(trx, real)).status).toBe("pending");
      expect((await emailRow(trx, seeded)).status).toBe("triaged");
    });
  });

  test("a mailbox without a settings row is skipped with one warn line over two runs", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const bare = await createOrgWithMailbox(trx);
      const bareCtx: TenantContext = { orgId: bare.orgId };
      const bareMail = await insertTestEmail(trx, bareCtx, bare.mailboxId, { message_id_header: "<b@ea-seed.test>" });
      const ready = await mailboxWithSettings(trx);
      const readyMail = await insertTestEmail(trx, ready.ctx, ready.mailboxId, {
        message_id_header: "<s@ea-seed.test>",
      });

      const llm = fakeLlm();
      const triage = job(trx, llm, { kind: "synthetic" });
      await triage.run();
      await triage.run();

      const lines = errorSpy.mock.calls.filter((call: unknown[]) =>
        String(call[1]).includes(`triage ${bare.mailboxId}: no mailbox_settings row, mailbox skipped`)
      );
      expect(lines).toHaveLength(1);
      expect(llm.prompts).toHaveLength(1);
      expect((await emailRow(trx, bareMail)).status).toBe("pending");
      expect((await emailRow(trx, readyMail)).status).toBe("triaged");
    });
  });

  test("a stale processing row is taken again and counts an attempt", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const stale = await insertTestEmail(trx, ctx, mailboxId, {
        status: "processing",
        locked_at: minutesFromNow(-10),
        attempts: 1,
      });
      const fresh = await insertTestEmail(trx, ctx, mailboxId, {
        status: "processing",
        locked_at: minutesFromNow(-1),
      });

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all", mailboxAddress: await addressOf(trx, mailboxId) }).run();

      expect(llm.prompts).toHaveLength(1);
      expect(await emailRow(trx, stale)).toEqual({ status: "triaged", attempts: 2 });
      expect((await emailRow(trx, fresh)).status).toBe("processing");
    });
  });

  test("a stale row whose take-back reaches the try limit ends as triage_error without an LLM call", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const stale = await insertTestEmail(trx, ctx, mailboxId, {
        status: "processing",
        locked_at: minutesFromNow(-10),
        attempts: 2,
      });

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all", mailboxAddress: await addressOf(trx, mailboxId) }).run();

      expect(llm.prompts).toHaveLength(0);
      expect(await emailRow(trx, stale)).toEqual({ status: "triaged", attempts: 3 });
      const triage = await trx
        .selectFrom("triage_results")
        .select(["category", "reason_code"])
        .where("email_id", "=", stale)
        .executeTakeFirstOrThrow();
      expect(triage).toEqual({ category: "unsure", reason_code: "triage_error" });
    });
  });
});

describe("createTriageJob: pause and errors", () => {
  function logLines(text: string): string[] {
    return errorSpy.mock.calls.map((call: unknown[]) => String(call[1])).filter((line: string) => line.includes(text));
  }

  // A fake LLM that throws `failWith` while it is set.
  function flakyLlm() {
    const llm = fakeLlm();
    const state: { failWith: Error | null } = { failWith: null };
    const inner = llm.classify.bind(llm);
    llm.classify = (async (req) => {
      if (state.failWith !== null) {
        llm.prompts.push(req.prompt);
        throw state.failWith;
      }
      return inner(req);
    }) as LlmClient["classify"];
    return { llm, state };
  }

  function clockJob(trx: Transaction<DB>, llm: LlmClient, clock: { at: Date }, overrides?: object) {
    return createTriageJob({
      db: trx,
      llm,
      pause: createLlmPause(),
      scope: { kind: "synthetic" },
      batchSize: 5,
      dailyCap: 1000,
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
      expect(logLines("LLM soft error")).toHaveLength(1);

      clock.at = minutesFromNow(1);
      await triage.run();
      expect(llm.prompts).toHaveLength(1);
      expect(logLines("LLM soft error")).toHaveLength(1);
      for (const id of [first, second, third]) {
        const row = await fullRow(trx, id);
        expect(row.status).toBe("pending");
        expect(row.locked_at).toBeNull();
      }

      clock.at = minutesFromNow(6);
      await triage.run();
      expect(llm.prompts).toHaveLength(2);
      const warns = logLines("LLM soft error");
      expect(warns).toHaveLength(2);
      expect(warns[1]).toContain("paused for 10 min");

      state.failWith = null;
      clock.at = minutesFromNow(17);
      await triage.run();
      for (const id of [first, second, third]) expect((await emailRow(trx, id)).status).toBe("triaged");

      state.failWith = new LlmSoftError("http_503", "fake-model");
      const later = await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<later@ea-seed.test>" });
      clock.at = minutesFromNow(18);
      await triage.run();
      expect((await emailRow(trx, later)).status).toBe("pending");
      expect(logLines("LLM soft error")[2]).toContain("paused for 5 min");
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
      expect(logLines("LLM config error")).toHaveLength(1);
      expect(logLines("failed:")).toHaveLength(0);
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
        clock.at = new Date(clock.at.getTime() + 61 * 60_000);
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

      const lines = logLines(`triage ${broken.mailboxId} failed:`);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(`triage ${broken.mailboxId} failed: ZodError`);
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
      const lines = logLines("failed:");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("Error");
      expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("MARKER-ERR");
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
      expect(logLines("triage_error save failed")).toHaveLength(1);
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

describe("createTriageJob: daily cap", () => {
  const dayStart = new Date("2026-11-05T08:00:00Z");

  function capLines(): string[] {
    return errorSpy.mock.calls
      .map((call: unknown[]) => String(call[1]))
      .filter((line: string) => line.includes("daily LLM cap reached for mailbox"));
  }

  test("at the cap two runs log one warn line; a blocklist mail in the batch is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await trx
        .insertInto("sender_rules")
        .values({ org_id: ctx.orgId, mailbox_id: mailboxId, pattern: "spam.test", kind: "blocklist" })
        .execute();
      for (let i = 0; i < 2; i += 1) {
        await recordAudit(trx, ctx, {
          actor: "system",
          event: auditEvents.llmCall,
          reasonCode: "ok",
          data: { mailbox_id: mailboxId },
          at: minutesFromNow(-10 + i),
        });
      }
      const first = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<a@ea-seed.test>",
        received_at: minutesFromNow(-30),
      });
      const blocked = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<b@ea-seed.test>",
        received_at: minutesFromNow(-20),
        from_address: "bad@spam.test",
      });
      const last = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<c@ea-seed.test>",
        received_at: minutesFromNow(-10),
      });
      const llm = fakeLlm();
      const capped = createTriageJob({
        db: trx,
        llm,
        pause: createLlmPause(),
        scope: { kind: "synthetic" },
        batchSize: 5,
        dailyCap: 2,
        now: () => now,
      });

      await capped.run();
      await capped.run();

      expect(llm.prompts).toHaveLength(0);
      expect((await emailRow(trx, blocked)).status).toBe("triaged");
      for (const id of [first, last]) {
        const row = await trx
          .selectFrom("emails")
          .select(["status", "attempts", "next_attempt_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({ status: "pending", attempts: 0, next_attempt_at: new Date("2026-11-06T08:00:00Z") });
      }
      const lines = capLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        `daily LLM cap reached for mailbox ${mailboxId}: 2 calls since ${dayStart.toISOString()} (America/Los_Angeles day); mail waits until 2026-11-06T08:00:00.000Z`
      );
    });
  });
});

async function addressOf(trx: Transaction<DB>, mailboxId: string): Promise<string> {
  const row = await trx.selectFrom("mailboxes").select("address").where("id", "=", mailboxId).executeTakeFirstOrThrow();
  return row.address;
}
