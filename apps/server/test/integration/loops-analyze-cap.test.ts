import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { recordLlmCall } from "../../src/modules/audit";
import { analyzeSent } from "../../src/modules/loops";
import { createLlmPause } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { LlmConfigError, LlmSoftError } from "../../src/platform/llm";
import { captureLogs, eventLines, logProblems } from "../log-capture";

import { testDb, withRollback } from "./helpers";
import {
  analysisOf,
  ASK,
  depsOf,
  fakeExtractor,
  loopsOrg,
  PLANTED_KEY,
  RUN_AT,
  sentMail,
} from "./loops-analyze-fixtures";
import { ago, type Org, siblingMailbox } from "./mail-sent-fixtures";

const MIN = 60_000;

// The cap, the retries and the logs of the Sent analysis (step 2).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

// One `llm.call` row of the mailbox, as triage writes it.
async function llmCall(trx: Trx, ctx: TenantContext, mailboxId: string, at: Date, role: "classifier" | "extractor") {
  await recordLlmCall(trx, ctx, {
    mailboxId,
    role,
    promptVersion: role === "classifier" ? "classifier-v3" : "extractor-v1",
    model: "m",
    endpoint: "standard",
    provider: "openai" as const,
    outcome: "ok",
    tokensIn: 1,
    tokensOut: 1,
    latencyMs: 1,
    at,
  });
}

async function calls(trx: Trx, org: Org, count: number, role: "classifier" | "extractor" = "classifier") {
  for (let i = 0; i < count; i += 1) await llmCall(trx, org.ctx, org.mailboxId, ago(HOUR_MS), role);
  // `ago` counts from the clock of `mail-sent-fixtures` (2026-11-20 10:00): inside the quota day of RUN_AT.
}

const run = (trx: Trx, org: Org, fake = fakeExtractor(), extra = {}, at = RUN_AT) =>
  analyzeSent(depsOf(trx, fake, extra), org.ctx, org.mailboxId, { now: at, limit: 20 });

describe("the daily cap", () => {
  test("T9: at 80 of a cap of 100 the row stays pending llm_cap until 5 minutes after the next quota day starts; no call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      await calls(trx, org, 80);
      const fake = fakeExtractor();
      const out = await run(trx, org, fake, { dailyCap: 100 });
      expect(out).toMatchObject({ waiting: 1, analysed: 0 });
      expect(fake.requests).toHaveLength(0);
      const row = await analysisOf(trx, id);
      expect(row).toMatchObject({ status: "pending", skip_reason: "llm_cap", attempts: 0 });
      // The quota day is the Pacific one: 2026-11-21 00:00 PST = 08:00 UTC, plus 5 minutes.
      expect(row?.next_attempt_at?.toISOString()).toBe("2026-11-21T08:05:00.000Z");

      // Not due before that time; at that time the new day has fewer calls: the row is analysed.
      const early = await run(trx, org, fake, { dailyCap: 100 }, new Date("2026-11-21T08:04:00Z"));
      expect(early.analysed).toBe(0);
      const later = await run(trx, org, fake, { dailyCap: 100 }, new Date("2026-11-21T08:05:00Z"));
      expect(later.analysed).toBe(1);
      expect(fake.requests).toHaveLength(1);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "done", skip_reason: null, next_attempt_at: null });
    });
  });

  test("79 of 100 still makes the call", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      await sentMail(trx, org);
      await calls(trx, org, 79);
      const fake = fakeExtractor();
      await run(trx, org, fake, { dailyCap: 100 });
      expect(fake.requests).toHaveLength(1);
    });
  });

  test("calls of another mailbox, another organization and the day before do not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const sibling = await siblingMailbox(trx, org);
      const other = await loopsOrg(trx);
      await sentMail(trx, org);
      await calls(trx, sibling, 60);
      // A forged row: the mailbox id of this mailbox, the organization of another one.
      for (let i = 0; i < 60; i += 1) await llmCall(trx, other.ctx, org.mailboxId, ago(HOUR_MS), "classifier");
      for (let i = 0; i < 60; i += 1) {
        await llmCall(trx, org.ctx, org.mailboxId, new Date("2026-11-20T07:00:00Z"), "classifier");
      }
      const fake = fakeExtractor();
      await run(trx, org, fake, { dailyCap: 100 });
      expect(fake.requests).toHaveLength(1);
    });
  });

  test("extractor calls count in the cap: the 9th call of a cap of 10 does not run", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const ids: string[] = [];
      for (let i = 0; i < 9; i += 1)
        ids.push(await sentMail(trx, org, { sentAt: new Date(RUN_AT.getTime() - (20 - i) * MIN) }));
      const fake = fakeExtractor();
      const out = await run(trx, org, fake, { dailyCap: 10 });
      expect(fake.requests).toHaveLength(8);
      expect(out).toMatchObject({ analysed: 8, waiting: 1 });
      expect(await analysisOf(trx, ids[8] as string)).toMatchObject({ status: "pending", skip_reason: "llm_cap" });
      const rows = await trx
        .selectFrom("audit_log")
        .select(["reason_code", "data"])
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "llm.call")
        .execute();
      expect(rows).toHaveLength(8);
      expect(rows[0]).toMatchObject({
        reason_code: "ok",
        data: {
          mailbox_id: org.mailboxId,
          role: "extractor",
          model: "fake-extractor",
          endpoint: "standard",
          provider: "openai" as const,
          prompt_version: "extractor-v1",
          tokens_in: 100,
          tokens_out: 20,
        },
      });
    });
  });
});

describe("failures", () => {
  test("T10: three hard errors end the row failed with 3 attempts; the retries wait 5 and 10 minutes", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      const fake = fakeExtractor(() => {
        // Not an LLM error: the client turns it into the code `unknown`.
        throw new TypeError("provider bug");
      });
      const deps = depsOf(trx, fake);
      const at = (minutes: number) => new Date(RUN_AT.getTime() + minutes * MIN);
      const step = (minutes: number) => analyzeSent(deps, org.ctx, org.mailboxId, { now: at(minutes), limit: 20 });

      expect((await step(0)).waiting).toBe(1);
      let row = await analysisOf(trx, id);
      expect(row).toMatchObject({ status: "pending", attempts: 1, skip_reason: null });
      expect(row?.next_attempt_at?.toISOString()).toBe(at(5).toISOString());

      // Not due yet.
      await step(4);
      expect(fake.requests).toHaveLength(1);

      await step(5);
      row = await analysisOf(trx, id);
      expect(row).toMatchObject({ status: "pending", attempts: 2 });
      expect(row?.next_attempt_at?.toISOString()).toBe(at(15).toISOString());

      expect((await step(15)).failed).toBe(1);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "failed", attempts: 3 });
      // A failed row is final.
      await step(60);
      expect(fake.requests).toHaveLength(3);
      const rows = await trx
        .selectFrom("audit_log")
        .select(["reason_code", "data"])
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "llm.call")
        .execute();
      expect(rows.map((r) => r.reason_code)).toEqual(["unknown", "unknown", "unknown"]);
      expect(rows[0]?.data).toMatchObject({ role: "extractor", model: "fake-extractor", endpoint: "standard" });
    });
  });

  test("a schema failure counts an attempt and writes the audit code bad_output", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      await run(trx, org, fakeExtractor({ ...ASK, language: "xx" as "pl" }));
      expect(await analysisOf(trx, id)).toMatchObject({ status: "pending", attempts: 1 });
      const row = await trx
        .selectFrom("audit_log")
        .select("reason_code")
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "llm.call")
        .executeTakeFirstOrThrow();
      expect(row.reason_code).toBe("bad_output");
    });
  });

  test("a soft error does not count an attempt: the run stops and the job pauses", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const first = await sentMail(trx, org);
      const second = await sentMail(trx, org);
      let failing = true;
      const fake = fakeExtractor(() => {
        if (failing) throw new LlmSoftError("http_429", "fake-extractor");
        return ASK;
      });
      const pause = createLlmPause();
      const deps = depsOf(trx, fake, { pause });
      const out = await analyzeSent(deps, org.ctx, org.mailboxId, { now: RUN_AT, limit: 20 });
      expect(out.stopped).toBe(true);
      // Only the first row was tried.
      expect(fake.requests).toHaveLength(1);
      expect(await analysisOf(trx, first)).toBeUndefined();
      expect(await analysisOf(trx, second)).toBeUndefined();
      expect(pause.isPaused(RUN_AT)).toBe(true);

      // During the pause the job calls nothing; after it the rows run, still with 0 attempts.
      await analyzeSent(deps, org.ctx, org.mailboxId, { now: new Date(RUN_AT.getTime() + MIN), limit: 20 });
      expect(fake.requests).toHaveLength(1);
      failing = false;
      const done = await analyzeSent(deps, org.ctx, org.mailboxId, {
        now: new Date(RUN_AT.getTime() + 6 * MIN),
        limit: 20,
      });
      expect(done.analysed).toBe(2);
      expect(await analysisOf(trx, first)).toMatchObject({ status: "done", attempts: 0 });
      const codes = await trx
        .selectFrom("audit_log")
        .select("reason_code")
        .where("org_id", "=", org.ctx.orgId)
        .where("event", "=", "llm.call")
        .orderBy("created_at")
        .execute();
      expect(codes[0]?.reason_code).toBe("http_429");
    });
  });

  test("a configuration error (a wrong key) stops the run and counts no attempt", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      const fake = fakeExtractor(() => {
        throw new LlmConfigError("http_401", "fake-extractor");
      });
      const pause = createLlmPause();
      const out = await run(trx, org, fake, { pause });
      expect(out.stopped).toBe(true);
      expect(await analysisOf(trx, id)).toBeUndefined();
      expect(pause.isPaused(RUN_AT)).toBe(true);
    });
  });
});

describe("timeouts and the cap share", () => {
  test("a timeout counts as an attempt: the third timeout ends the row failed, and the job is not paused", async () => {
    await withRollback(db, async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      const fake = fakeExtractor(() => {
        throw new LlmSoftError("timeout", "fake-extractor");
      });
      const pause = createLlmPause();
      const deps = depsOf(trx, fake, { pause });
      for (const minutes of [0, 5, 15]) {
        const out = await analyzeSent(deps, org.ctx, org.mailboxId, {
          now: new Date(RUN_AT.getTime() + minutes * MIN),
          limit: 20,
        });
        expect(out.stopped).toBe(false);
      }
      expect(fake.requests).toHaveLength(3);
      expect(await analysisOf(trx, id)).toMatchObject({ status: "failed", attempts: 3 });
      expect(pause.isPaused(new Date(RUN_AT.getTime() + 15 * MIN))).toBe(false);
    });
  });

  // The call runs only while (used + 1) * 5 <= cap * 4: the share never rounds up.
  const shares: [number, number][] = [
    [1, 0],
    [3, 2],
    [7, 5],
    [100, 80],
    [300, 240],
  ];
  for (const [cap, calls] of shares) {
    test(`a cap of ${cap} allows ${calls} calls (the last one at ${Math.max(calls - 1, 0)} used)`, async () => {
      await withRollback(db, async (trx) => {
        const org = await loopsOrg(trx);
        for (let i = 0; i < calls + 2; i += 1) {
          await sentMail(trx, org, { sentAt: new Date(RUN_AT.getTime() - (400 - i) * MIN) });
        }
        const fake = fakeExtractor();
        await analyzeSent(depsOf(trx, fake, { dailyCap: cap }), org.ctx, org.mailboxId, { now: RUN_AT, limit: 500 });
        expect(fake.requests).toHaveLength(calls);
      });
    });
  }
});

describe("logs", () => {
  test("no line holds the subject, the text, an address or the key; the lines carry counts and codes", async () => {
    const capture = captureLogs();
    let auditText = "";
    try {
      await withRollback(db, async (trx) => {
        const org = await loopsOrg(trx);
        await sentMail(trx, org, {
          subject: "SUBJECT-MARK",
          body: "BODY-MARK can you send the numbers?",
          to: ["person-mark@example.test"],
        });
        await sentMail(trx, org, { subject: "SUBJECT-MARK-2", body: "BODY-MARK-2", to: ["other-mark@example.test"] });
        let call = 0;
        const fake = fakeExtractor(() => {
          call += 1;
          if (call === 1) throw new TypeError("BODY-MARK provider bug person-mark@example.test");
          return { ...ASK, ask: "ASK-MARK" };
        });
        await run(trx, org, fake);
        // The audit rows hold no planted value either.
        const audit = await trx.selectFrom("audit_log").selectAll().where("org_id", "=", org.ctx.orgId).execute();
        auditText = JSON.stringify(audit);
      });
    } finally {
      capture.stop();
    }
    const planted = ["SUBJECT-MARK", "BODY-MARK", "person-mark@example.test", "other-mark", "ASK-MARK", PLANTED_KEY];
    expect(logProblems(capture.lines, planted)).toEqual([]);
    expect(auditText).not.toBe("");
    for (const value of planted) expect(auditText).not.toContain(value);
    const done = eventLines(capture.lines, "sent_analysis_done");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ count: 1, opened: 1 });
    expect(done[0]).toHaveProperty("mailbox_id");
    const failed = eventLines(capture.lines, "sent_analysis_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ error_code: "unknown" });
  });
});
