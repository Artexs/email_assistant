import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { createReplyJobs } from "../../src/modules/replies";

import { testDb } from "./helpers";
import {
  addReplyMail,
  at,
  fakeLlm,
  CLEAN_ANSWER,
  jobDeps,
  llmCallRows,
  NOW,
  pairRows,
  queueRequest,
  requestOf,
  requestsOf,
  setSwitch,
  setupBox,
  type Clock,
  type JobBox,
} from "./reply-job-fixtures";

// The tests that need real commits (a rollback test cannot show that a crash undoes a write, or that two runs wait
// for each other). Each test makes its own organization and deletes it at the end; the job runs for that mailbox only.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function committedBox(): Promise<JobBox> {
  return db.transaction().execute((trx) => setupBox(trx));
}

async function dropBox(box: JobBox): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", box.ctx.orgId).execute();
  await db.deleteFrom("users").where("id", "=", box.userId).execute();
}

async function openSends(box: JobBox) {
  return db
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", box.ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", ["awaiting_approval", "approved", "applying"])
    .execute();
}

const fresh = (): Clock => ({ now: NOW });

describe("the drafter job with real commits (F115 stage 07)", () => {
  test("4. kill point: the model answers, the write throws once: no half pair, a counted try; the next run writes one pair; two model calls", async () => {
    const box = await committedBox();
    try {
      const mail = await db.transaction().execute((trx) => addReplyMail(trx, box));
      const clock = fresh();
      let kills = 1;
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      const jobs = createReplyJobs(
        jobDeps(db, llm, clock, {
          // The throw comes after the rows of the pair are inserted, before the commit.
          beforeCommit: async () => {
            if (kills > 0) {
              kills -= 1;
              throw new Error("kill point");
            }
          },
        })
      );

      const first = await jobs.drafter.run({ mailboxId: box.mailboxId });

      expect(first.outcomes.retry).toBe(1);
      expect(await pairRows(db, box)).toEqual([]);
      expect(
        await db
          .selectFrom("audit_log")
          .select("id")
          .where("org_id", "=", box.ctx.orgId)
          .where("event", "=", "action.planned")
          .execute()
      ).toEqual([]);
      const [waiting] = await requestsOf(db, box);
      expect(waiting).toMatchObject({ status: "pending", attempts: 1, email_id: mail, send_action_id: null });
      expect(waiting?.next_attempt_at.getTime()).toBe(NOW.getTime() + 5 * MINUTE_MS);
      // The call was paid and counted although the write failed.
      expect(await llmCallRows(db, box)).toHaveLength(1);

      clock.now = new Date(NOW.getTime() + 6 * MINUTE_MS);
      await jobs.drafter.run({ mailboxId: box.mailboxId });

      expect(requests).toHaveLength(2);
      expect(await llmCallRows(db, box)).toHaveLength(2);
      const pair = await pairRows(db, box);
      expect(pair.map((row) => row.type)).toEqual(["create_draft", "send"]);
      expect(await requestOf(db, waiting?.id ?? "")).toMatchObject({
        status: "done",
        attempts: 1,
        send_action_id: pair[1]?.id,
      });
      // A third run finds nothing to do and calls nothing.
      await jobs.drafter.run({ mailboxId: box.mailboxId });
      expect(requests).toHaveLength(2);
      expect(await pairRows(db, box)).toHaveLength(2);
    } finally {
      await dropBox(box);
    }
  });

  test("4b. the write fails on every run: three counted tries, then failed / internal; no pair, three model calls", async () => {
    const box = await committedBox();
    try {
      await db.transaction().execute((trx) => addReplyMail(trx, box));
      const clock = fresh();
      const { llm } = fakeLlm(() => CLEAN_ANSWER);
      const jobs = createReplyJobs(
        jobDeps(db, llm, clock, {
          beforeCommit: async () => {
            throw new Error("kill point");
          },
        })
      );
      const seen: [string, number][] = [];
      for (let i = 0; i < 3; i += 1) {
        clock.now = new Date(NOW.getTime() + i * 6 * MINUTE_MS);
        await jobs.drafter.run({ mailboxId: box.mailboxId });
        const [request] = await requestsOf(db, box);
        seen.push([request?.status ?? "", request?.attempts ?? -1]);
      }
      expect(seen).toEqual([
        ["pending", 1],
        ["pending", 2],
        ["failed", 2],
      ]);
      expect((await requestsOf(db, box))[0]?.reason_code).toBe("internal");
      expect(await pairRows(db, box)).toEqual([]);
      expect(await llmCallRows(db, box)).toHaveLength(3);
    } finally {
      await dropBox(box);
    }
  });

  test("8. two instances at once on two mails of one thread: the second waits for the thread lock and then sees the first: exactly one open reply send", async () => {
    const box = await committedBox();
    try {
      const thread = "thread-concurrent";
      const a = await db
        .transaction()
        .execute((trx) => addReplyMail(trx, box, { threadKey: thread, receivedAt: at(-120) }));
      const b = await db
        .transaction()
        .execute((trx) => addReplyMail(trx, box, { threadKey: thread, receivedAt: at(-115) }));
      // A is older, so instance one claims it (the claim reads `created_at`, oldest first).
      const requestA = await queueRequest(db, box, a, "auto", { at: new Date(NOW.getTime() - MINUTE_MS) });
      const requestB = await queueRequest(db, box, b, "auto");

      // Instance one stops inside its write transaction, after it inserted its pair and before it commits.
      let inside!: () => void;
      const hasInside = new Promise<void>((resolve) => {
        inside = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const one = createReplyJobs(
        jobDeps(db, fakeLlm(() => CLEAN_ANSWER).llm, fresh(), {
          claimLimit: 1,
          beforeCommit: async () => {
            inside();
            await gate;
          },
        })
      );
      const two = createReplyJobs(jobDeps(db, fakeLlm(() => CLEAN_ANSWER).llm, fresh(), { claimLimit: 1 }));

      const runOne = one.drafter.run({ mailboxId: box.mailboxId });
      await hasInside;
      const runTwo = two.drafter.run({ mailboxId: box.mailboxId });
      // Instance two either waits for the thread lock (right) or runs to its end (wrong: it did not see the pair of instance one).
      const waiting = async (): Promise<"blocked"> => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const { rows } = await sql<{ count: number }>`
            select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted`.execute(db);
          if ((rows[0]?.count ?? 0) > 0) return "blocked";
          await Bun.sleep(20);
        }
        throw new Error("instance two neither waited nor finished");
      };
      await Promise.race([waiting(), runTwo.then(() => "finished")]);
      release();
      await Promise.all([runOne, runTwo]);

      const open = await openSends(box);
      expect(open.map((row) => row.email_id)).toEqual([b]);
      expect(await requestOf(db, requestA)).toMatchObject({ status: "done" });
      expect(await requestOf(db, requestB)).toMatchObject({ status: "done" });
      const closedA = (await pairRows(db, box)).find((row) => row.type === "send" && row.email_id === a);
      expect(closedA).toMatchObject({ status: "expired", status_reason: "newer_mail" });
    } finally {
      await dropBox(box);
    }
  });

  test("8b. the other order: the newer mail writes first: the older request ends superseded, one open reply send", async () => {
    const box = await committedBox();
    try {
      const thread = "thread-concurrent-2";
      const a = await db
        .transaction()
        .execute((trx) => addReplyMail(trx, box, { threadKey: thread, receivedAt: at(-120), category: "info" }));
      const b = await db
        .transaction()
        .execute((trx) => addReplyMail(trx, box, { threadKey: thread, receivedAt: at(-115) }));
      // Only the newer mail needs a reply at first; the older one turns into a needs_reply mail after the newer draft is stored.
      const jobs = createReplyJobs(jobDeps(db, fakeLlm(() => CLEAN_ANSWER).llm, fresh()));
      await jobs.drafter.run({ mailboxId: box.mailboxId });
      const requestB = (await requestsOf(db, box))[0]?.id ?? "";
      await db
        .insertInto("triage_results")
        .values({
          org_id: box.ctx.orgId,
          email_id: a,
          category: "needs_reply",
          confidence: 0.9,
          reason_code: "direct_request",
          fields: JSON.stringify({ language: "pl" }),
          created_at: new Date(NOW.getTime() - MINUTE_MS),
        })
        .execute();
      await jobs.drafter.run({ mailboxId: box.mailboxId });
      const requestA = (await requestsOf(db, box)).find((request) => request.email_id === a)?.id ?? "";

      expect(await requestOf(db, requestB)).toMatchObject({ status: "done" });
      const openAfter = await openSends(box);
      expect(openAfter.map((row) => row.email_id)).toEqual([b]);
      expect(await requestOf(db, requestA)).toMatchObject({
        status: "superseded",
        reason_code: "open_newer",
        send_action_id: openAfter[0]?.id,
      });
    } finally {
      await dropBox(box);
    }
  });

  test("the write waits for a setter that turns the switch off and then sees its commit: cancelled / switch_off, no pair", async () => {
    const box = await committedBox();
    try {
      const mail = await db.transaction().execute((trx) => addReplyMail(trx, box));
      const request = await queueRequest(db, box, mail, "auto");
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // The setter holds the settings row (FOR UPDATE) and has changed the switch, but has not committed.
      const setter = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom("mailbox_settings")
          .select("mailbox_id")
          .where("mailbox_id", "=", box.mailboxId)
          .forUpdate()
          .execute();
        await setSwitch(trx, box.mailboxId, false);
        locked();
        await gate;
      });
      await hasLock;
      const { llm } = fakeLlm(() => CLEAN_ANSWER);
      const run = createReplyJobs(jobDeps(db, llm, fresh())).drafter.run({ mailboxId: box.mailboxId });
      const waiting = async (): Promise<"blocked"> => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const { rows } = await sql<{ count: number }>`
            select count(*)::int as count from pg_locks where not granted and locktype in ('transactionid', 'tuple')`.execute(
            db
          );
          if ((rows[0]?.count ?? 0) > 0) return "blocked";
          await Bun.sleep(20);
        }
        throw new Error("the write neither waited nor finished");
      };
      await Promise.race([waiting(), run.then(() => "finished")]);
      release();
      await Promise.all([setter, run]);

      expect(await requestOf(db, request)).toMatchObject({ status: "cancelled", reason_code: "switch_off" });
      expect(await pairRows(db, box)).toEqual([]);
    } finally {
      await dropBox(box);
    }
  });

  test("two instances over many requests: each request is drafted once (one model call and one pair for each)", async () => {
    const box = await committedBox();
    try {
      const ids: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const mail = await db
          .transaction()
          .execute((trx) => addReplyMail(trx, box, { receivedAt: new Date(NOW.getTime() - (i + 1) * MINUTE_MS * 10) }));
        ids.push(await queueRequest(db, box, mail, "auto"));
      }
      const delayed = () =>
        fakeLlm(async () => {
          await Bun.sleep(10);
          return CLEAN_ANSWER;
        });
      const llmOne = delayed();
      const llmTwo = delayed();
      const one = createReplyJobs(jobDeps(db, llmOne.llm, fresh(), { claimLimit: 3 }));
      const two = createReplyJobs(jobDeps(db, llmTwo.llm, fresh(), { claimLimit: 3 }));

      await Promise.all([one.drafter.run({ mailboxId: box.mailboxId }), two.drafter.run({ mailboxId: box.mailboxId })]);

      expect(llmOne.requests.length + llmTwo.requests.length).toBe(6);
      expect((await pairRows(db, box)).filter((row) => row.type === "send")).toHaveLength(6);
      for (const id of ids) expect(await requestOf(db, id)).toMatchObject({ status: "done", attempts: 0 });
    } finally {
      await dropBox(box);
    }
  });
});
