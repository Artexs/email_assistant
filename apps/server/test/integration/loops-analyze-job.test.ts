import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { sentSwitchHooks } from "../../src/composition";
import { analyzeSent, createLoopJobs, writeExtraction } from "../../src/modules/loops";
import { setSentSync } from "../../src/modules/mail";
import { createLlmPause } from "../../src/modules/triage";
import { LlmSoftError } from "../../src/platform/llm";

import { pauseOtherMailboxes, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { analysisOf, ASK, fakeExtractor, loopsOf, loopsOrg, RUN_AT, sentMail } from "./loops-analyze-fixtures";
import type { Org } from "./mail-sent-fixtures";

// The job loops.analyze (F116 stage 12, step 3): the runner, `job:run`, and the lock order with the switch.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const SEED_ID = "<seed-1@ea-seed.test>";

describe("createLoopJobs", () => {
  test("a run walks the active mailboxes and returns counts", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await loopsOrg(trx);
      const b = await loopsOrg(trx);
      await sentMail(trx, a);
      await sentMail(trx, b);
      const fake = fakeExtractor(ASK);
      const jobs = createLoopJobs({ db: trx, llm: fake.llm, dailyCap: 300, scope: { kind: "all" }, now: () => RUN_AT });
      const out = await jobs.analyze.run();
      expect(out).toMatchObject({ mailboxes: 2, analysed: 2, opened: 2, mailboxErrors: 0, stopped: false });
      expect(fake.requests).toHaveLength(2);
    });
  });

  test("the error of one mailbox does not stop the next", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await loopsOrg(trx);
      const b = await loopsOrg(trx);
      await sentMail(trx, a);
      await sentMail(trx, b);
      const fake = fakeExtractor(ASK);
      const jobs = createLoopJobs({
        db: trx,
        llm: fake.llm,
        dailyCap: 300,
        scope: { kind: "all" },
        now: () => RUN_AT,
        analyze: async (deps, ctx, mailboxId, opts) => {
          if (mailboxId === a.mailboxId) throw new Error("boom");
          return analyzeSent(deps, ctx, mailboxId, opts);
        },
      });
      const out = await jobs.analyze.run();
      expect(out).toMatchObject({ mailboxes: 1, mailboxErrors: 1, analysed: 1, opened: 1 });
      expect((await loopsOf(trx, b)).length).toBe(1);
    });
  });

  test("a soft error of the model stops the later mailboxes of the run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await loopsOrg(trx);
      const b = await loopsOrg(trx);
      await sentMail(trx, a);
      await sentMail(trx, b);
      const fake = fakeExtractor(() => {
        throw new LlmSoftError("http_503", "fake-extractor");
      });
      const jobs = createLoopJobs({ db: trx, llm: fake.llm, dailyCap: 300, scope: { kind: "all" }, now: () => RUN_AT });
      const out = await jobs.analyze.run();
      expect(out.stopped).toBe(true);
      expect(fake.requests).toHaveLength(1);
      // The next run of the same job object is paused: no call.
      await jobs.analyze.run();
      expect(fake.requests).toHaveLength(1);
    });
  });

  test("a suspended organization and a paused mailbox are not walked", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const suspended = await loopsOrg(trx);
      await sentMail(trx, suspended);
      await suspendOrg(trx, suspended.ctx.orgId);
      const fake = fakeExtractor(ASK);
      const jobs = createLoopJobs({ db: trx, llm: fake.llm, dailyCap: 300, scope: { kind: "all" }, now: () => RUN_AT });
      expect(await jobs.analyze.run()).toMatchObject({ mailboxes: 0, analysed: 0 });
      expect(fake.requests).toHaveLength(0);
    });
  });

  test("the synthetic scope reads test mail only: a real mail gets no row and no call", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const org = await loopsOrg(trx);
      const real = await sentMail(trx, org);
      const seed = await sentMail(trx, org, { messageId: SEED_ID });
      const sender = await sentMail(trx, org, { fromAddress: "tester@x.test" });
      const fake = fakeExtractor(ASK);
      const jobs = createLoopJobs({
        db: trx,
        llm: fake.llm,
        dailyCap: 300,
        scope: { kind: "synthetic", testMail: { senders: ["tester@x.test"] } },
        now: () => RUN_AT,
      });
      await jobs.analyze.run();
      expect(await analysisOf(trx, real)).toBeUndefined();
      expect((await analysisOf(trx, seed))?.status).toBe("done");
      expect((await analysisOf(trx, sender))?.status).toBe("done");
      expect(fake.requests).toHaveLength(2);
    });
  });
});

const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/job-run.ts");

async function runJob(args: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return { code, stdout: await new Response(proc.stdout).text(), stderr: await new Response(proc.stderr).text() };
}

// A committed organization: a subprocess cannot see rows of a rolled-back transaction. It is removed in `finally`.
async function committedOrg(): Promise<Org & { ids: string[] }> {
  return db.transaction().execute(async (trx) => {
    const org = await loopsOrg(trx);
    const ids = [
      // A test mail with a list marker: the code filters end it, so no model call is needed.
      await sentMail(trx, org, { messageId: SEED_ID, listId: "<news.example.test>", subject: "SUBJECT-MARK" }),
      // A real mail: the synthetic scope leaves it alone.
      await sentMail(trx, org, { subject: "REAL-SUBJECT-MARK", to: ["real-mark@example.test"] }),
    ];
    return { ...org, ids };
  });
}

async function removeOrg(org: Org): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", org.ctx.orgId).execute();
  await db.deleteFrom("users").where("id", "=", org.userId).execute();
}

describe("job:run --name loops.analyze", () => {
  // The keys are fake: a call that slipped through would fail with a key error, never spend.
  const env = { TRIAGE_LLM_SCOPE: "synthetic", OPENAI_API_KEY: "fake-key", GEMINI_API_KEY: "fake-key" };

  test("T11: runs once on a fixture organization and prints counts only", async () => {
    const org = await committedOrg();
    try {
      const result = await runJob(["--name", "loops.analyze"], env);
      expect(result.stderr).not.toContain("failed");
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\[job-run\] loops\.analyze: ran once \(mailboxes \d+, analysed \d+, skipped \d+,/);
      // The result line holds counts only; the log lines hold ids and counts. No subject and no address anywhere.
      const resultLine = result.stdout.split("\n").filter((line) => line.startsWith("[job-run]"));
      expect(resultLine).toHaveLength(1);
      expect(resultLine[0]).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
      for (const text of ["SUBJECT-MARK", "example.test", "x.test", "@"]) {
        expect(result.stdout + result.stderr).not.toContain(text);
      }
      const rows = await db.selectFrom("sent_analyses").selectAll().where("org_id", "=", org.ctx.orgId).execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sent_email_id: org.ids[0], status: "skipped", skip_reason: "list" });
    } finally {
      await removeOrg(org);
    }
  });

  test("with TRIAGE_LLM_SCOPE off the job refuses to run", async () => {
    const result = await runJob(["--name", "loops.analyze"], { ...env, TRIAGE_LLM_SCOPE: "off" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("TRIAGE_LLM_SCOPE is off");
  });
});

describe("the lock order with the switch (Track my sent mail)", () => {
  async function committedWithRow() {
    return db.transaction().execute(async (trx) => {
      const org = await loopsOrg(trx);
      const id = await sentMail(trx, org);
      return { ...org, id };
    });
  }

  test("a write that runs now finishes first; the switch then closes the loop it opened (no deadlock)", async () => {
    const org = await committedWithRow();
    try {
      let release!: () => void;
      const hold = new Promise<void>((resolveHold) => {
        release = resolveHold;
      });
      let written!: () => void;
      const writtenSignal = new Promise<void>((resolveWritten) => {
        written = resolveWritten;
      });
      const writer = db.transaction().execute(async (trx) => {
        const env = {
          mailboxId: org.mailboxId,
          ownAddresses: [],
          timeZone: "Europe/Warsaw",
          waitDays: 3,
          delegates: [],
          now: RUN_AT,
        };
        const row = await trx.selectFrom("sent_emails").selectAll().where("id", "=", org.id).executeTakeFirstOrThrow();
        const outcome = await writeExtraction(
          trx,
          org.ctx,
          env,
          {
            id: row.id,
            threadKey: row.thread_key,
            messageId: row.message_id,
            referencesIds: row.references_ids,
            fromAddress: null,
            to: row.to_addresses,
            cc: row.cc_addresses,
            subject: row.subject,
            bodyText: row.body_text,
            content: "stored",
            sentAt: row.sent_at,
            listId: null,
            autoSubmitted: null,
            hasCalendar: false,
            actionId: null,
            attempts: 0,
          },
          {
            expectsReply: true,
            ask: "send the numbers",
            due: null,
            promise: null,
            promiseDue: null,
            language: "en",
          },
          "extractor-v1"
        );
        expect(outcome).toEqual({ kind: "written", opened: 1 });
        written();
        await hold;
      });
      await writtenSignal;
      // The switch waits for the lock of the state row that the writer holds.
      const off = setSentSync(
        db,
        org.ctx,
        org.mailboxId,
        { enabled: false, actor: "test", at: new Date(RUN_AT.getTime() + 1000) },
        sentSwitchHooks
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      release();
      await writer;
      expect((await off).result).toBe("changed");
      const loops = await db.selectFrom("open_loops").selectAll().where("org_id", "=", org.ctx.orgId).execute();
      expect(loops).toHaveLength(1);
      expect(loops[0]).toMatchObject({ status: "closed", close_reason: "sent_off", text: null, subject: null });
    } finally {
      await removeOrg(org);
    }
  });

  test("a switch that runs first makes the write wait, then write nothing", async () => {
    const org = await committedWithRow();
    try {
      let release!: () => void;
      const hold = new Promise<void>((resolveHold) => {
        release = resolveHold;
      });
      let started!: () => void;
      const startedSignal = new Promise<void>((resolveStarted) => {
        started = resolveStarted;
      });
      const switcher = db.transaction().execute(async (trx) => {
        await setSentSync(trx, org.ctx, org.mailboxId, { enabled: false, actor: "test", at: RUN_AT }, sentSwitchHooks);
        started();
        await hold;
      });
      await startedSignal;
      const fake = fakeExtractor(ASK);
      const analysing = analyzeSent(
        { db, llm: fake.llm, dailyCap: 300, scope: { kind: "all" }, pause: createLlmPause() },
        org.ctx,
        org.mailboxId,
        { now: RUN_AT, limit: 20 }
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
      release();
      await switcher;
      const out = await analysing;
      expect(out.opened).toBe(0);
      const loops = await db.selectFrom("open_loops").selectAll().where("org_id", "=", org.ctx.orgId).execute();
      expect(loops).toHaveLength(0);
    } finally {
      await removeOrg(org);
    }
  });
});
