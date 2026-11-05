import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { insertDefaultSettings } from "../../src/modules/config";
import { createLlmPause, createTriageJob, type TriageScope } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

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
  return createTriageJob({ db: trx, llm, pause: createLlmPause(), scope, batchSize: 5, now: () => now });
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

async function addressOf(trx: Transaction<DB>, mailboxId: string): Promise<string> {
  const row = await trx.selectFrom("mailboxes").select("address").where("id", "=", mailboxId).executeTakeFirstOrThrow();
  return row.address;
}
