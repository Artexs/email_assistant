import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listSendsToNotify } from "../../src/modules/actions";
import { detectNotices } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createReplyJobs } from "../../src/modules/replies";
import type { DB } from "../../src/platform/db";
import { LlmSoftError } from "../../src/platform/llm";

import {
  insertDraftAndSend,
  isolateChannels,
  linkChat,
  pauseOtherMailboxes,
  randomChatId,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  addReplyMail,
  at,
  CLEAN_ANSWER,
  fakeLlm,
  jobDeps,
  llmCallRows,
  NOW,
  pairRows,
  queueRequest,
  requestOf,
  requestsOf,
  runJob,
  setupBox,
  type Clock,
  type JobBox,
} from "./reply-job-fixtures";

// Fixes of the review: the generic approval notice never shows a reply send, a timeout counts as a
// try, the write checks the organization, the mailbox and the category again, an open reply of the same mail does not count
// as a newer one. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const fresh = (): Clock => ({ now: NOW });

async function markDraftApplied(trx: Transaction<DB>, draftId: string): Promise<void> {
  await trx
    .updateTable("actions")
    .set({ status: "applied", applied_at: NOW, provider_result: JSON.stringify({ folder: "Drafts", uid: 1 }) })
    .where("id", "=", draftId)
    .execute();
}

describe("N1: the generic approval notice skips a reply send", () => {
  test("a drafted reply whose draft is applied gets no notice and no notified_at; a clarification send of the same org still gets its card", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      await isolateChannels(trx);
      const s = await setupBox(trx);
      await linkChat(trx, s.ctx, s.userId, randomChatId(), at(-60));
      await addReplyMail(trx, s, { from: "anna@client.test" });
      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);
      const [draft, send] = await pairRows(trx, s);
      await markDraftApplied(trx, draft?.id ?? "");
      // The control: a send of another kind in the same org is notified by the same detector.
      const clarification = await insertDraftAndSend(trx, s.ctx, s.mailboxId, {
        kind: "clarification",
        to: "boss@x.test",
        task: "Which supplier?",
      });

      expect((await listSendsToNotify(trx, s.ctx, { limit: 50 })).map((row) => row.id)).toEqual([clarification.sendId]);
      await detectNotices({ db: trx, now: () => at(1), startedAt: at(-60), testMail: NO_TEST_SENDERS });

      const rows = await trx
        .selectFrom("outbox")
        .select(["kind", "dedup_key", "view"])
        .where("org_id", "=", s.ctx.orgId)
        .execute();
      expect(rows.filter((row) => row.kind === "approval").map((row) => row.dedup_key)).toEqual([
        `approval:${clarification.sendId}`,
      ]);
      // No row of any kind holds the id of the reply send or its text.
      expect(JSON.stringify(rows)).not.toContain(send?.id ?? "no-send");
      expect(JSON.stringify(rows)).not.toContain("wtorek mi pasuje");
      const reply = await trx
        .selectFrom("actions")
        .select("notified_at")
        .where("id", "=", send?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(reply.notified_at).toBeNull();
    });
  });
});

describe("N2: a timeout counts as a try", () => {
  test("a mail whose call always times out ends after three tries: llm_error, three rows, no pair; a 503 still counts none", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      await addReplyMail(trx, s);
      const { llm, requests } = fakeLlm(() => new LlmSoftError("timeout", "fake-drafter"));
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));
      const states: [string, number][] = [];
      for (let i = 0; i < 4; i += 1) {
        clock.now = at(i * 6);
        await jobs.drafter.run({ mailboxId: s.mailboxId });
        const [request] = await requestsOf(trx, s);
        states.push([request?.status ?? "", request?.attempts ?? -1]);
      }
      expect(states).toEqual([
        ["pending", 1],
        ["pending", 2],
        ["failed", 2],
        ["failed", 2],
      ]);
      expect((await requestsOf(trx, s))[0]?.reason_code).toBe("llm_error");
      expect(requests).toHaveLength(3);
      expect((await llmCallRows(trx, s)).map((row) => row.reason_code)).toEqual(["timeout", "timeout", "timeout"]);
      expect(await pairRows(trx, s)).toEqual([]);

      const other = await setupBox(trx);
      await addReplyMail(trx, other);
      const soft = fakeLlm(() => new LlmSoftError("http_503", "fake-drafter"));
      await runJob(jobDeps(trx, soft.llm, fresh()), other);
      expect((await requestsOf(trx, other))[0]).toMatchObject({ status: "pending", attempts: 0 });
    });
  });
});

describe("N3: the write checks the organization, the mailbox and the category again", () => {
  async function during(
    trx: Transaction<DB>,
    change: (s: JobBox, emailId: string) => Promise<unknown>,
    trigger: "auto" | "tap"
  ) {
    const s = await setupBox(trx);
    const emailId = await addReplyMail(trx, s, trigger === "tap" ? { category: "info" } : {});
    if (trigger === "tap") await queueRequest(trx, s, emailId, "tap");
    const { llm, requests } = fakeLlm(async () => {
      await change(s, emailId);
      return CLEAN_ANSWER;
    });
    await runJob(jobDeps(trx, llm, fresh()), s);
    const [request] = await requestsOf(trx, s);
    expect(requests).toHaveLength(1);
    expect(await pairRows(trx, s)).toEqual([]);
    // The call was paid: its row counts.
    expect(await llmCallRows(trx, s)).toHaveLength(1);
    return request;
  }

  test("the organization is suspended during the call: cancelled / org_suspended, no pair", async () => {
    await withRollback(db, async (trx) => {
      const request = await during(trx, (s) => suspendOrg(trx, s.ctx.orgId), "auto");
      expect(request).toMatchObject({ status: "cancelled", reason_code: "org_suspended" });
    });
  });

  test("the mailbox is paused during the call: cancelled / mailbox_inactive, no pair", async () => {
    await withRollback(db, async (trx) => {
      const request = await during(
        trx,
        (s) => trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.mailboxId).execute(),
        "auto"
      );
      expect(request).toMatchObject({ status: "cancelled", reason_code: "mailbox_inactive" });
    });
  });

  test("the newest triage result turns to spam during the call: cancelled / spam, for an automatic request and for a tap", async () => {
    await withRollback(db, async (trx) => {
      for (const trigger of ["auto", "tap"] as const) {
        const request = await during(
          trx,
          (s, emailId) =>
            trx
              .insertInto("triage_results")
              .values({
                org_id: s.ctx.orgId,
                email_id: emailId,
                category: "spam",
                confidence: 0.9,
                reason_code: "spam",
                fields: JSON.stringify({ language: "pl" }),
                created_at: at(1),
              })
              .execute(),
          trigger
        );
        expect([trigger, request?.status, request?.reason_code]).toEqual([trigger, "cancelled", "spam"]);
      }
    });
  });
});

describe("TG1: an open reply of this very mail is not a newer one", () => {
  test("a tap on a mail whose automatic draft waits: superseded / open_newer with that send, still one pair", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const mail = await addReplyMail(trx, s);
      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);
      const [, send] = await pairRows(trx, s);
      const tap = await queueRequest(trx, s, mail, "tap");

      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, { now: at(1) }), s);

      expect(await requestOf(trx, tap)).toMatchObject({
        status: "superseded",
        reason_code: "open_newer",
        send_action_id: send?.id,
      });
      expect(await pairRows(trx, s)).toHaveLength(2);
    });
  });
});
