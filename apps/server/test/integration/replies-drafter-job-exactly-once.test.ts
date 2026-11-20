import { randomUUID } from "node:crypto";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { createPlanned } from "../../src/modules/actions";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { createReplyJobs } from "../../src/modules/replies";
import { createLlmPause } from "../../src/modules/triage";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { fresh, openReplySends } from "./replies-drafter-job-helpers";
import {
  addReplyMail,
  at,
  CLEAN_ANSWER,
  fakeLlm,
  jobDeps,
  NOW,
  pairRows,
  queueRequest,
  requestOf,
  requestsOf,
  runJob,
  seedLlmCalls,
  setSwitch,
  setupBox,
} from "./reply-job-fixtures";

// The drafter job (scan, claim, call, write) against Postgres with a fake model. Every test runs in a transaction that
// is rolled back. The tests that need a real commit (the kill point, two instances at once) are in replies-drafter-committed.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the drafter job: one draft per request, exactly once", () => {
  test("a stored result: the keys of the request exist, so the request ends done with that send and no model call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const mail = await addReplyMail(trx, s);
      const first = fakeLlm(() => CLEAN_ANSWER);
      await runJob(jobDeps(trx, first.llm, fresh()), s);
      const [request] = await requestsOf(trx, s);
      const [, send] = await pairRows(trx, s);
      // Put the request back as if the write had committed but the end of the request had not (a crash between the two statements).
      await trx
        .updateTable("reply_requests")
        .set({ status: "pending", send_action_id: null, next_attempt_at: NOW })
        .where("id", "=", request?.id ?? "")
        .execute();
      const second = fakeLlm(() => CLEAN_ANSWER);

      await runJob(jobDeps(trx, second.llm, fresh()), s);

      expect(second.requests).toHaveLength(0);
      expect(await requestOf(trx, request?.id ?? "")).toMatchObject({ status: "done", send_action_id: send?.id });
      expect(await pairRows(trx, s)).toHaveLength(2);
      expect(mail).toBe(request?.email_id ?? "");
    });
  });

  test("a stale drafting request is taken back with one more try; at three tries it ends llm_error with no model call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const one = await addReplyMail(trx, s, { category: "info" });
      const two = await addReplyMail(trx, s, { category: "info" });
      const stale = async (emailId: string, attempts: number): Promise<string> => {
        const id = await queueRequest(trx, s, emailId, "tap");
        await trx
          .updateTable("reply_requests")
          .set({ status: "drafting", locked_at: new Date(NOW.getTime() - 6 * MINUTE_MS), attempts })
          .where("id", "=", id)
          .execute();
        return id;
      };
      const fine = await stale(one, 1);
      const dead = await stale(two, 2);
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);

      await runJob(jobDeps(trx, llm, fresh()), s);

      expect(await requestOf(trx, fine)).toMatchObject({ status: "done", attempts: 2 });
      expect(await requestOf(trx, dead)).toMatchObject({ status: "failed", reason_code: "llm_error", attempts: 3 });
      expect(requests).toHaveLength(1);
    });
  });

  test("a worker that lost its claim during the call writes nothing: the request keeps the new claim", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const later = new Date(NOW.getTime() + 7 * MINUTE_MS);
      const { llm } = fakeLlm(async () => {
        // Another run took the request back (a stale take-back) while this call was under way.
        await trx
          .updateTable("reply_requests")
          .set({ locked_at: later })
          .where("mailbox_id", "=", s.mailboxId)
          .execute();
        return CLEAN_ANSWER;
      });

      const run = await runJob(jobDeps(trx, llm, fresh()), s);

      expect(run.outcomes.lost).toBe(1);
      expect(await pairRows(trx, s)).toEqual([]);
      const [request] = await requestsOf(trx, s);
      expect(request?.status).toBe("drafting");
      expect(request?.locked_at?.getTime()).toBe(later.getTime());
    });
  });

  test("a worker that lost its claim does not end the request either: a no_draft answer leaves the new claim alone", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const later = new Date(NOW.getTime() + 7 * MINUTE_MS);
      const { llm } = fakeLlm(async () => {
        await trx
          .updateTable("reply_requests")
          .set({ locked_at: later })
          .where("mailbox_id", "=", s.mailboxId)
          .execute();
        return { decision: "no_draft", reason_code: "needs_facts", body: "", gaps: [], language: "pl" };
      });

      const run = await runJob(jobDeps(trx, llm, fresh()), s);

      expect(run.outcomes.lost).toBe(1);
      const [request] = await requestsOf(trx, s);
      expect(request?.status).toBe("drafting");
      expect(request?.locked_at?.getTime()).toBe(later.getTime());
    });
  });

  test("a pair with the keys of the request that appears during the call (another worker wrote it, the user closed it): no second pair, the request ends done with it", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const emailId = await addReplyMail(trx, s);
      const [request0] = await (async () => {
        await queueRequest(trx, s, emailId, "auto");
        return requestsOf(trx, s);
      })();
      const requestId = request0?.id ?? "";
      let storedSend = "";
      const { llm } = fakeLlm(async () => {
        const created = await createPlanned(trx, s.ctx, emailId, [
          {
            type: "create_draft",
            payload: {
              kind: "reply",
              to: ["other@client.test"],
              cc: [],
              language: "pl",
              body: "Tekst innego procesu.",
              request_id: requestId,
              folder: "INBOX",
              recipients: "from",
            },
            status: "ready",
            idempotencyKey: `${requestId}:create_draft`,
          },
          {
            type: "send",
            payload: { kind: "reply", to: ["other@client.test"], cc: [] },
            status: "awaiting_approval",
            idempotencyKey: `${requestId}:send`,
            dependsOn: "create_draft",
          },
        ]);
        storedSend = created.find((action) => action.type === "send")?.id ?? "";
        // The user already closed that send: the thread rule does not see an open reply, so only the keys stop a second pair.
        await trx
          .updateTable("actions")
          .set({ status: "expired", status_reason: "timeout" })
          .where("id", "=", storedSend)
          .execute();
        return CLEAN_ANSWER;
      });

      await runJob(jobDeps(trx, llm, fresh()), s);

      expect(await pairRows(trx, s)).toHaveLength(2);
      expect(await requestOf(trx, requestId)).toMatchObject({ status: "done", send_action_id: storedSend });
    });
  });

  test("the cap line: 239 rows let an automatic request draft; 240 make it wait", async () => {
    await withRollback(db, async (trx) => {
      const low = await setupBox(trx);
      await addReplyMail(trx, low);
      await seedLlmCalls(trx, low, 239);
      const first = fakeLlm(() => CLEAN_ANSWER);
      await runJob(jobDeps(trx, first.llm, fresh()), low);
      expect(first.requests).toHaveLength(1);
      expect((await requestsOf(trx, low))[0]?.status).toBe("done");

      const high = await setupBox(trx);
      await addReplyMail(trx, high);
      await seedLlmCalls(trx, high, 240);
      const second = fakeLlm(() => CLEAN_ANSWER);
      await runJob(jobDeps(trx, second.llm, fresh()), high);
      expect(second.requests).toHaveLength(0);
      expect((await requestsOf(trx, high))[0]?.status).toBe("pending");
    });
  });

  test("the thread rule is per mailbox: an open reply of the same thread key in another mailbox of the org is not touched", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const { llm } = fakeLlm(() => CLEAN_ANSWER);
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));
      await addReplyMail(trx, s, { threadKey: "shared-thread", receivedAt: at(-120) });
      await jobs.drafter.run({ mailboxId: s.mailboxId });

      // A second mailbox of the same org with a newer mail of a thread of the same key.
      const otherMailbox = randomUUID();
      await trx
        .insertInto("mailboxes")
        .columns([
          "id",
          "org_id",
          "address",
          "imap_host",
          "imap_port",
          "smtp_host",
          "smtp_port",
          "capabilities",
          "folder_map",
        ])
        .values({
          id: otherMailbox,
          org_id: s.ctx.orgId,
          address: `second-${otherMailbox}@x.test`,
          imap_host: "imap.x.test",
          imap_port: 993,
          smtp_host: "smtp.x.test",
          smtp_port: 465,
          capabilities: JSON.stringify({}),
          folder_map: JSON.stringify({ drafts: "Drafts" }),
        })
        .execute();
      await insertDefaultSettings(trx, s.ctx, otherMailbox);
      await updateMailboxSettings(trx, s.ctx, otherMailbox, { mode: "assist" });
      await setSwitch(trx, otherMailbox, true);
      const second = { ...s, mailboxId: otherMailbox };
      await addReplyMail(trx, second, { threadKey: "shared-thread", receivedAt: at(-115) });
      clock.now = new Date(NOW.getTime() + MINUTE_MS);
      // The scan of the first mailbox does not take the mail of the second one.
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      expect(await requestsOf(trx, s)).toHaveLength(1);
      expect(await requestsOf(trx, second)).toHaveLength(0);
      await createReplyJobs(jobDeps(trx, llm, clock)).drafter.run({ mailboxId: otherMailbox });

      expect(await requestsOf(trx, second)).toHaveLength(1);
      expect(await openReplySends(trx, s)).toHaveLength(2);
    });
  });

  test("a sample request stores its text and no pair, also in shadow mode", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx, { mode: "shadow" });
      const mail = await addReplyMail(trx, s, { category: "info" });
      const id = await queueRequest(trx, s, mail, "sample");
      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);
      expect(await requestOf(trx, id)).toMatchObject({
        status: "done",
        sample_body: CLEAN_ANSWER.body,
        send_action_id: null,
      });
      expect(await pairRows(trx, s)).toEqual([]);
    });
  });

  test("a mail with no stored text ends no_draft / no_text without a call; no_draft from the model keeps its reason", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s, { body: null });
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      await runJob(jobDeps(trx, llm, fresh()), s);
      expect((await requestsOf(trx, s))[0]).toMatchObject({ status: "no_draft", reason_code: "no_text" });
      expect(requests).toHaveLength(0);

      const other = await setupBox(trx);
      await addReplyMail(trx, other);
      const none = fakeLlm(() => ({
        decision: "no_draft",
        reason_code: "needs_facts",
        body: "",
        gaps: [],
        language: "pl",
      }));
      await runJob(jobDeps(trx, none.llm, fresh()), other);
      expect((await requestsOf(trx, other))[0]).toMatchObject({ status: "no_draft", reason_code: "needs_facts" });
      expect(await pairRows(trx, other)).toEqual([]);
    });
  });

  test("an organization that is suspended during the run is skipped: its mailbox gets no scan and no call", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const first = await setupBox(trx);
      const second = await setupBox(trx);
      // The targets are in the order of `created_at` and then `id`; both mailboxes were made in one transaction (one `now()`), so
      // the test sets the order, whatever the clock of the machine is.
      for (const [box, createdAt] of [
        [first, new Date("2001-01-01T00:00:00Z")],
        [second, new Date("2099-01-01T00:00:00Z")],
      ] as const) {
        await trx.updateTable("mailboxes").set({ created_at: createdAt }).where("id", "=", box.mailboxId).execute();
      }
      await addReplyMail(trx, first);
      await addReplyMail(trx, second);
      const { llm, requests } = fakeLlm(async () => {
        // The first mailbox is in work; the operator suspends the second organization now.
        await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", second.ctx.orgId).execute();
        return CLEAN_ANSWER;
      });

      const run = await createReplyJobs(jobDeps(trx, llm, fresh())).drafter.run();

      expect(requests).toHaveLength(1);
      expect(run.requested).toBe(1);
      expect(await requestsOf(trx, second)).toHaveLength(0);
      expect(await pairRows(trx, second)).toEqual([]);
    });
  });

  test("the scope: under synthetic a real mail makes no request and a tap on it is cancelled llm_scope; a test mail is drafted", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const real = await addReplyMail(trx, s);
      const synthetic = await addReplyMail(trx, s, { messageId: "<case-1@ea-seed.test>" });
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      const tap = await queueRequest(trx, s, real, "tap");
      const deps = jobDeps(trx, llm, fresh(), { scope: { kind: "synthetic", testMail: { senders: [] } } });

      await runJob(deps, s);

      expect(await requestOf(trx, tap)).toMatchObject({ status: "cancelled", reason_code: "llm_scope" });
      const rows = await requestsOf(trx, s);
      expect(rows.filter((row) => row.trigger === "auto").map((row) => row.email_id)).toEqual([synthetic]);
      expect(requests).toHaveLength(1);
    });
  });

  test("the scan makes at most 50 requests per mailbox and run; a run drafts at most 5", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      for (let i = 0; i < 52; i += 1) {
        await addReplyMail(trx, s, { receivedAt: new Date(NOW.getTime() - HOUR_MS - i * MINUTE_MS) });
      }
      const { llm } = fakeLlm(() => CLEAN_ANSWER);
      const run = await runJob(jobDeps(trx, llm, fresh()), s);
      expect(run).toMatchObject({ requested: 50, claimed: 5 });
      expect(await requestsOf(trx, s)).toHaveLength(50);
      expect((await requestsOf(trx, s)).filter((row) => row.status === "done")).toHaveLength(5);
      // Different threads: the five drafts are five open replies, none closes another.
      expect(await openReplySends(trx, s)).toHaveLength(5);

      // The scan skips mail that has a request, so the next run reaches the two mails that the limit left out.
      const again = await runJob(jobDeps(trx, llm, fresh()), s);
      expect(again.requested).toBe(2);
      expect(await requestsOf(trx, s)).toHaveLength(52);
    });
  });

  test("a suspended organization and a paused model: nothing is claimed", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const before = await trx
        .selectFrom("organizations")
        .select("plan")
        .where("id", "=", s.ctx.orgId)
        .executeTakeFirstOrThrow();
      await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", s.ctx.orgId).execute();
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      const run = await runJob(jobDeps(trx, llm, fresh()), s);
      expect(run).toMatchObject({ mailboxes: 0, requested: 0, claimed: 0 });
      expect(requests).toHaveLength(0);

      await trx.updateTable("organizations").set({ plan: before.plan }).where("id", "=", s.ctx.orgId).execute();
      const pause = createLlmPause();
      pause.trip("soft", "http_503", NOW);
      const paused = await runJob(jobDeps(trx, llm, fresh(), { pause }), s);
      expect(paused).toMatchObject({ claimed: 0, requested: 0 });
      expect(requests).toHaveLength(0);
    });
  });
});
