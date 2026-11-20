import { nextQuotaDayStart, QUOTA_TIMEZONE, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { createCommitterJob } from "../../src/modules/actions";
import { updateMailboxSettings } from "../../src/modules/config";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createReplyJobs } from "../../src/modules/replies";
import { setOrgFeature } from "../../src/modules/tenancy";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { secrets, fresh, openReplySends } from "./replies-drafter-job-helpers";
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
  seedLlmCalls,
  setSwitch,
  setupBox,
  type JobBox,
} from "./reply-job-fixtures";

// The drafter job (scan, claim, call, write) against Postgres with a fake model. Every test runs in a transaction that
// is rolled back. The tests that need a real commit (the kill point, two instances at once) are in replies-drafter-committed.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("the drafter job (F115 stage 07)", () => {
  test("1. a clean needs_reply mail in assist with the switch and the flag on: one request done, one create_draft ready, one send awaiting_approval of kind reply, one llm.call row", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const emailId = await addReplyMail(trx, s, { from: "anna@client.test", fromName: "Anna" });
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);

      const run = await runJob(jobDeps(trx, llm, fresh()), s);

      expect(run).toMatchObject({ requested: 1, claimed: 1, outcomes: { done: 1 } });
      expect(requests).toHaveLength(1);
      const [request] = await requestsOf(trx, s);
      expect(request).toMatchObject({
        status: "done",
        trigger: "auto",
        email_id: emailId,
        attempts: 0,
        folder: "INBOX",
      });
      const pair = await pairRows(trx, s);
      expect(pair.map((row) => [row.type, row.status])).toEqual([
        ["create_draft", "ready"],
        ["send", "awaiting_approval"],
      ]);
      const [draft, send] = pair;
      expect(request?.send_action_id).toBe(send?.id);
      expect(draft?.payload).toEqual({
        kind: "reply",
        to: ["anna@client.test"],
        cc: [],
        language: "pl",
        body: CLEAN_ANSWER.body.trimEnd(),
        request_id: request?.id,
        folder: "INBOX",
        recipients: "from",
      });
      expect(send?.payload).toEqual({ kind: "reply", to: ["anna@client.test"], cc: [] });
      expect(send?.depends_on_action_id).toBe(draft?.id);
      expect([draft?.idempotency_key, send?.idempotency_key]).toEqual([
        `${request?.id}:create_draft`,
        `${request?.id}:send`,
      ]);
      const calls = await llmCallRows(trx, s);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        reason_code: "ok",
        email_id: emailId,
        data: { role: "drafter", model: "fake-drafter", endpoint: "standard", mailbox_id: s.mailboxId, tokens_in: 100 },
      });
      // One planned row for each action of the pair.
      const planned = await trx
        .selectFrom("audit_log")
        .select("action_id")
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", "action.planned")
        .execute();
      expect(planned.map((row) => row.action_id).sort()).toEqual([draft?.id ?? "", send?.id ?? ""].sort());
    });
  });

  test("2. the committer then APPENDs one copy to Drafts: In-Reply-To of the original, the Re: subject and X-EA-Action-Id", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await setupBox(trx);
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", sent: "Sent" }) })
        .where("id", "=", s.mailboxId)
        .execute();
      const secret = secrets.encrypt("pw", `mailbox:${s.mailboxId}`);
      await insertCredentials(trx, s.ctx, {
        mailboxId: s.mailboxId,
        encryptedSecret: secret.ciphertext,
        secretKind: "password",
        keyVersion: secret.keyVersion,
      });
      await addReplyMail(trx, s, {
        from: "anna@client.test",
        subject: "Spotkanie",
        messageId: "<orig-77@client.test>",
      });
      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);

      const fake = createFakeMailProvider();
      await fake.ensureFolder("Drafts");
      await fake.ensureFolder("Sent");
      const appended: Buffer[] = [];
      const append = fake.appendMessage.bind(fake);
      fake.appendMessage = async (folder, raw, flags, internalDate) => {
        appended.push(raw);
        return append(folder, raw, flags, internalDate);
      };
      const sender = createFakeMailSender();
      await createCommitterJob({
        db: trx,
        secrets,
        openProvider: async () => fake,
        openSender: async () => sender,
        compose: composeMessage,
        scope: { kind: "all" },
        sendScope: { kind: "all" },
        now: () => NOW,
      }).run();

      const [draft, send] = await pairRows(trx, s);
      expect(draft?.status).toBe("applied");
      expect(send?.status).toBe("awaiting_approval");
      expect(appended).toHaveLength(1);
      const raw = appended[0]?.toString("utf8") ?? "";
      expect(raw).toMatch(/^In-Reply-To: <orig-77@client\.test>/m);
      expect(raw).toMatch(/^Subject: Re: Spotkanie/m);
      expect(raw).toMatch(/^To: .*anna@client\.test/m);
      expect(raw.toLowerCase()).toContain(`x-ea-action-id: ${draft?.id}`);
      expect(raw).toContain("Tak, wtorek mi pasuje.");
      // The job never sends: nothing reached the SMTP sender.
      expect(sender.calls).toEqual([]);
    });
  });

  test("3. the job runs twice: still one pair, one request, one model call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      const jobs = createReplyJobs(jobDeps(trx, llm, fresh()));

      await jobs.drafter.run({ mailboxId: s.mailboxId });
      const second = await jobs.drafter.run({ mailboxId: s.mailboxId });

      expect(second).toMatchObject({ requested: 0, claimed: 0 });
      expect(await requestsOf(trx, s)).toHaveLength(1);
      expect(await pairRows(trx, s)).toHaveLength(2);
      expect(requests).toHaveLength(1);
    });
  });

  test("5. shadow mode, the switch off, the flag off, an OAuth mailbox, an old mail, other categories and untriaged mail: no request", async () => {
    await withRollback(db, async (trx) => {
      const cases: { name: string; box: () => Promise<JobBox> }[] = [
        { name: "shadow", box: () => setupBox(trx, { mode: "shadow" }) },
        { name: "switch off", box: () => setupBox(trx, { switchOn: false }) },
        { name: "flag off", box: () => setupBox(trx, { flag: false }) },
        {
          name: "oauth",
          box: async () => {
            const box = await setupBox(trx);
            await trx
              .updateTable("mailboxes")
              .set({ oauth_provider: "google" })
              .where("id", "=", box.mailboxId)
              .execute();
            return box;
          },
        },
      ];
      for (const { name, box } of cases) {
        const s = await box();
        await addReplyMail(trx, s);
        const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
        const run = await runJob(jobDeps(trx, llm, fresh()), s);
        expect([name, run.requested, requests.length, (await requestsOf(trx, s)).length]).toEqual([name, 0, 0, 0]);
      }
      const s = await setupBox(trx);
      await addReplyMail(trx, s, { receivedAt: new Date(NOW.getTime() - 8 * DAY_MS) });
      await addReplyMail(trx, s, { category: "info" });
      const untriaged = await addReplyMail(trx, s);
      await trx.updateTable("emails").set({ status: "pending" }).where("id", "=", untriaged).execute();
      const run = await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);
      expect(run.requested).toBe(0);
    });
  });

  test("5b. a gate that closes after the request exists: the job cancels it with the reason and calls no model", async () => {
    await withRollback(db, async (trx) => {
      for (const [reason, close] of [
        ["switch_off", (s: JobBox) => setSwitch(trx, s.mailboxId, false)],
        [
          "not_assist",
          (s: JobBox) => updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "shadow" }).then(() => undefined),
        ],
        [
          "feature_off",
          (s: JobBox) => setOrgFeature(trx, s.ctx, { flag: "reply_drafts", enabled: false, actor: "cli", now: NOW }),
        ],
      ] as const) {
        const s = await setupBox(trx);
        const emailId = await addReplyMail(trx, s);
        const requestsMade = fakeLlm(() => CLEAN_ANSWER);
        // The request exists (the scan ran while the gates were open); the gate closes before the claim.
        await queueRequest(trx, s, emailId, "auto");
        await close(s);
        await runJob(jobDeps(trx, requestsMade.llm, fresh()), s);
        const [request] = await requestsOf(trx, s);
        expect([reason, request?.status, request?.reason_code]).toEqual([reason, "cancelled", reason]);
        expect(requestsMade.requests).toHaveLength(0);
        expect(await pairRows(trx, s)).toEqual([]);
      }
    });
  });

  test("6. the cap: an automatic request waits at 80 %, a tap drafts; at 100 % a tap fails llm_cap; the cap holds for the retry", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const auto = await addReplyMail(trx, s);
      await seedLlmCalls(trx, s, 240);
      const first = fakeLlm(() => CLEAN_ANSWER);
      const clock = fresh();
      const jobs = createReplyJobs(jobDeps(trx, first.llm, clock));

      const run = await jobs.drafter.run({ mailboxId: s.mailboxId });

      expect(run.outcomes.waiting).toBe(1);
      expect(first.requests).toHaveLength(0);
      const [waiting] = await requestsOf(trx, s);
      expect(waiting).toMatchObject({ status: "pending", attempts: 0, email_id: auto });
      expect(waiting?.next_attempt_at.getTime()).toBe(nextQuotaDayStart(NOW, QUOTA_TIMEZONE).getTime());

      // A tap on another mail uses the rest of the cap.
      const tapped = await addReplyMail(trx, s, { category: "info" });
      const tapId = await queueRequest(trx, s, tapped, "tap");
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      expect(await requestOf(trx, tapId)).toMatchObject({ status: "done" });
      expect(first.requests).toHaveLength(1);
      // The waiting request is still waiting.
      expect(await requestOf(trx, waiting?.id ?? "")).toMatchObject({ status: "pending" });

      // At the next quota day it drafts.
      clock.now = new Date(nextQuotaDayStart(NOW, QUOTA_TIMEZONE).getTime() + MINUTE_MS);
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      expect(await requestOf(trx, waiting?.id ?? "")).toMatchObject({ status: "done" });
    });
  });

  test("6b. 300 rows today: a tap fails llm_cap with no call; the failed request is told with its code", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const mail = await addReplyMail(trx, s, { category: "info" });
      await seedLlmCalls(trx, s, 300);
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      const id = await queueRequest(trx, s, mail, "tap");

      await runJob(jobDeps(trx, llm, fresh()), s);

      expect(await requestOf(trx, id)).toMatchObject({ status: "failed", reason_code: "llm_cap" });
      expect(requests).toHaveLength(0);
      expect(await pairRows(trx, s)).toEqual([]);
    });
  });

  test("6c. one call left under the cap: the retry after a failed check does not run, so the day stays at the cap", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const mail = await addReplyMail(trx, s, { category: "info" });
      await seedLlmCalls(trx, s, 299);
      const { llm, requests } = fakeLlm(() => ({
        ...CLEAN_ANSWER,
        body: "Dzień dobry, zobacz https://evil.example/x w tej sprawie.",
      }));
      const id = await queueRequest(trx, s, mail, "tap");

      await runJob(jobDeps(trx, llm, fresh()), s);

      expect(requests).toHaveLength(1);
      expect(await requestOf(trx, id)).toMatchObject({ status: "failed", reason_code: "checks" });
      expect((await llmCallRows(trx, s)).length).toBe(300);
    });
  });

  test("7. mails A (10:00) and B (10:05) of one thread: A drafted, then B drafted: A's send closes newer_mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const thread = "thread-ab";
      const a = await addReplyMail(trx, s, { threadKey: thread, receivedAt: at(-120) });
      const { llm } = fakeLlm(() => CLEAN_ANSWER);
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      const [sendA] = await openReplySends(trx, s);
      expect(sendA?.email_id).toBe(a);

      const b = await addReplyMail(trx, s, { threadKey: thread, receivedAt: at(-115) });
      clock.now = new Date(NOW.getTime() + MINUTE_MS);
      await jobs.drafter.run({ mailboxId: s.mailboxId });

      const open = await openReplySends(trx, s);
      expect(open.map((row) => row.email_id)).toEqual([b]);
      const closedA = await trx
        .selectFrom("actions")
        .selectAll()
        .where("id", "=", sendA?.id ?? "")
        .executeTakeFirstOrThrow();
      expect(closedA).toMatchObject({ status: "expired", status_reason: "newer_mail" });
      const draftA = await trx
        .selectFrom("actions")
        .selectAll()
        .where("id", "=", closedA.depends_on_action_id ?? "")
        .executeTakeFirstOrThrow();
      expect(["expired", "cancelled", "undone", "applied"]).toContain(draftA.status);
      // One audit row names the reason.
      const audit = await trx
        .selectFrom("audit_log")
        .select("reason_code")
        .where("action_id", "=", sendA?.id ?? "")
        .where("event", "=", "action.expired")
        .execute();
      expect(audit.map((row) => row.reason_code)).toEqual(["newer_mail"]);
    });
  });

  test("7b. B is drafted first: A's request ends superseded and names the open send of the thread", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const thread = "thread-ba";
      const a = await addReplyMail(trx, s, {
        threadKey: thread,
        receivedAt: at(-120),
        category: "info",
      });
      const b = await addReplyMail(trx, s, { threadKey: thread, receivedAt: at(-115) });
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      const [sendB] = await openReplySends(trx, s);
      expect(sendB?.email_id).toBe(b);

      // A turns into a needs_reply mail afterwards (a new result row).
      await trx
        .insertInto("triage_results")
        .values({
          org_id: s.ctx.orgId,
          email_id: a,
          category: "needs_reply",
          confidence: 0.9,
          reason_code: "direct_request",
          fields: JSON.stringify({ language: "pl" }),
          created_at: new Date(NOW.getTime() - MINUTE_MS),
        })
        .execute();
      await jobs.drafter.run({ mailboxId: s.mailboxId });

      const requestA = (await requestsOf(trx, s)).find((request) => request.email_id === a);
      expect(requestA).toMatchObject({ status: "superseded", reason_code: "open_newer", send_action_id: sendB?.id });
      expect((await openReplySends(trx, s)).map((row) => row.id)).toEqual([sendB?.id ?? ""]);
      // The model ran for B and for A (the request found the open reply only at the write).
      expect(requests).toHaveLength(2);
    });
  });
});
