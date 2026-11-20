import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { reject, replaceApproval, noApprovalHooks, noDelegationHooks } from "../../src/modules/actions";
import { updateMailboxSettings } from "../../src/modules/config";
import { createReplyJobs } from "../../src/modules/replies";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause } from "../../src/modules/triage";
import { LlmConfigError, LlmHardError, LlmSoftError } from "../../src/platform/llm";
import { captureLogs, logProblems } from "../log-capture";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { fresh, openReplySends } from "./replies-drafter-job-helpers";
import {
  addReplyMail,
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
  test("9. the model gives a link twice: failed / checks, two calls, no pair, nothing shown", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const { llm, requests } = fakeLlm(() => ({
        ...CLEAN_ANSWER,
        body: "Dzień dobry, zobacz https://evil.example/x w tej sprawie.",
      }));

      await runJob(jobDeps(trx, llm, fresh()), s);

      expect(requests).toHaveLength(2);
      const [request] = await requestsOf(trx, s);
      expect(request).toMatchObject({ status: "failed", reason_code: "checks" });
      expect(await pairRows(trx, s)).toEqual([]);
      expect((await llmCallRows(trx, s)).map((row) => row.reason_code)).toEqual(["ok", "ok"]);
    });
  });

  test("9b. a new account number that the user did not type fails account_number on every attempt; one the user typed passes", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const iban = "PL61 1090 1014 0000 0712 1981 2874";
      const { llm } = fakeLlm(() => ({ ...CLEAN_ANSWER, body: `Dzień dobry, proszę wpłacić na konto ${iban}.` }));
      await runJob(jobDeps(trx, llm, fresh()), s);
      const [request] = await requestsOf(trx, s);
      expect(request).toMatchObject({ status: "failed", reason_code: "checks" });
      expect(await pairRows(trx, s)).toEqual([]);

      // The same text with the number in the instruction of the user: allowed.
      const tapMail = await addReplyMail(trx, s, { category: "info" });
      const tapId = await queueRequest(trx, s, tapMail, "tap", { instruction: `Podaj konto ${iban}` });
      await runJob(jobDeps(trx, llm, fresh()), s);
      expect(await requestOf(trx, tapId)).toMatchObject({ status: "done" });
    });
  });

  test("9c. LLM text is never a recipient, a folder or a command: extra keys fail the schema, a header line in the body fails the checks", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      await addReplyMail(trx, s);
      const keys = fakeLlm(() => ({ ...CLEAN_ANSWER, recipient: "evil@x.test", folder: "Trash", command: "DELETE" }));
      await runJob(jobDeps(trx, keys.llm, fresh()), s);
      expect((await requestsOf(trx, s))[0]).toMatchObject({ status: "failed", reason_code: "output" });
      expect(await pairRows(trx, s)).toEqual([]);
      expect((await llmCallRows(trx, s)).map((row) => row.reason_code)).toEqual(["bad_output", "bad_output"]);

      const other = await setupBox(trx);
      await addReplyMail(trx, other);
      const header = fakeLlm(() => ({ ...CLEAN_ANSWER, body: "Dzień dobry, tak.\nBcc: evil@x.test\nCc: boss@x.test" }));
      await runJob(jobDeps(trx, header.llm, fresh()), other);
      expect((await requestsOf(trx, other))[0]).toMatchObject({ status: "failed", reason_code: "checks" });
      expect(await pairRows(trx, other)).toEqual([]);
    });
  });

  test("10. a gate or a fact that changes between the model call and the write: cancelled with the reason, no pair", async () => {
    await withRollback(db, async (trx) => {
      const changes: [string, (s: JobBox, emailId: string) => Promise<unknown>][] = [
        ["switch_off", (s) => setSwitch(trx, s.mailboxId, false)],
        ["not_assist", (s) => updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "shadow" })],
        [
          "feature_off",
          (s) => setOrgFeature(trx, s.ctx, { flag: "reply_drafts", enabled: false, actor: "cli", now: NOW }),
        ],
        [
          "answered",
          (s, emailId) =>
            trx
              .insertInto("email_flags")
              .values({
                email_id: emailId,
                org_id: s.ctx.orgId,
                answered: true,
                checked_at: NOW,
                seen: true,
                flagged: false,
              })
              .execute(),
        ],
        [
          "suspicious",
          (s, emailId) =>
            trx
              .insertInto("triage_results")
              .values({
                org_id: s.ctx.orgId,
                email_id: emailId,
                category: "needs_reply",
                confidence: 0.9,
                reason_code: "direct_request",
                fields: JSON.stringify({ language: "pl" }),
                suspicious_reasons: ["reply_to_mismatch"],
                created_at: new Date(NOW.getTime() + 1),
              })
              .execute(),
        ],
      ];
      for (const [reason, change] of changes) {
        const s = await setupBox(trx);
        const emailId = await addReplyMail(trx, s);
        const { llm, requests } = fakeLlm(async () => {
          await change(s, emailId);
          return CLEAN_ANSWER;
        });
        await runJob(jobDeps(trx, llm, fresh()), s);
        const [request] = await requestsOf(trx, s);
        expect([reason, request?.status, request?.reason_code]).toEqual([reason, "cancelled", reason]);
        expect(requests).toHaveLength(1);
        expect(await pairRows(trx, s)).toEqual([]);
        // The call was paid: its row counts.
        expect(await llmCallRows(trx, s)).toHaveLength(1);
      }
    });
  });

  test("11. a redraft makes version 2 of the waiting send; a redraft whose send was rejected before the call ends cancelled / closed with no call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const emailId = await addReplyMail(trx, s);
      const answers = [CLEAN_ANSWER, { ...CLEAN_ANSWER, body: "Dzień dobry,\n\nW środę o dziesiątej, pasuje." }];
      const { llm, requests } = fakeLlm((call) => answers[Math.min(call - 1, 1)] ?? CLEAN_ANSWER);
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      const [first] = await openReplySends(trx, s);

      const redraft = await queueRequest(trx, s, emailId, "redraft", {
        instruction: "Zaproponuj środę.",
        previousSendId: first?.id ?? null,
      });
      clock.now = new Date(NOW.getTime() + MINUTE_MS);
      await jobs.drafter.run({ mailboxId: s.mailboxId });

      const done = await requestOf(trx, redraft);
      expect(done.status).toBe("done");
      const [second] = await openReplySends(trx, s);
      expect(second?.id).not.toBe(first?.id);
      expect(done.send_action_id).toBe(second?.id ?? null);
      expect(
        await trx
          .selectFrom("actions")
          .select(["status", "status_reason"])
          .where("id", "=", first?.id ?? "")
          .executeTakeFirstOrThrow()
      ).toEqual({
        status: "expired",
        status_reason: "superseded",
      });
      const newDraft = await trx
        .selectFrom("actions")
        .select("payload")
        .where("id", "=", second?.depends_on_action_id ?? "")
        .executeTakeFirstOrThrow();
      expect(newDraft.payload).toMatchObject({
        version: 2,
        body: "Dzień dobry,\n\nW środę o dziesiątej, pasuje.",
        request_id: redraft,
      });
      expect(requests[1]?.prompt).toContain("Zaproponuj środę.");
      expect(requests).toHaveLength(2);

      // The user rejects the new version; a second redraft of it has no place to go.
      await reject(
        { db: trx, hooks: noDelegationHooks, approvalHooks: noApprovalHooks, uidplus: async () => true },
        s.ctx,
        second?.id ?? "",
        { userId: s.userId, via: "cli", now: clock.now }
      );
      const late = await queueRequest(trx, s, emailId, "redraft", { previousSendId: second?.id ?? null });
      clock.now = new Date(NOW.getTime() + 2 * MINUTE_MS);
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      expect(await requestOf(trx, late)).toMatchObject({ status: "cancelled", reason_code: "closed" });
      expect(requests).toHaveLength(2);
      expect(await openReplySends(trx, s)).toEqual([]);
    });
  });

  test("11c. another version replaces the send while the model works: cancelled / changed, no pair of this request", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const emailId = await addReplyMail(trx, s);
      await createReplyJobs(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, clock)).drafter.run({
        mailboxId: s.mailboxId,
      });
      const [first] = await openReplySends(trx, s);
      const redraft = await queueRequest(trx, s, emailId, "redraft", { previousSendId: first?.id ?? null });
      const { llm } = fakeLlm(async () => {
        // The user edits the text in the panel: version 2 replaces the send that the redraft was asked for.
        await replaceApproval(trx, s.ctx, {
          sendId: first?.id ?? "",
          payload: { body_text: "Tekst od użytkownika." },
          userId: s.userId,
          via: "web",
          now: clock.now,
          deps: { hooks: noDelegationHooks, approvalHooks: noApprovalHooks, uidplus: async () => true },
        });
        return CLEAN_ANSWER;
      });

      await createReplyJobs(jobDeps(trx, llm, clock)).drafter.run({ mailboxId: s.mailboxId });

      expect(await requestOf(trx, redraft)).toMatchObject({ status: "cancelled", reason_code: "changed" });
      const open = await openReplySends(trx, s);
      expect(open).toHaveLength(1);
      expect(open[0]?.id).not.toBe(first?.id);
    });
  });

  test("a tap on mail that the rules block, and a tap on an OAuth mailbox: cancelled with the reason, no model call", async () => {
    await withRollback(db, async (trx) => {
      const flagged = await setupBox(trx);
      const flaggedMail = await addReplyMail(trx, flagged);
      await trx
        .updateTable("triage_results")
        .set({ suspicious_reasons: ["reply_to_mismatch"] })
        .where("email_id", "=", flaggedMail)
        .execute();
      const answered = await setupBox(trx);
      const answeredMail = await addReplyMail(trx, answered);
      await trx
        .insertInto("email_flags")
        .values({
          email_id: answeredMail,
          org_id: answered.ctx.orgId,
          answered: true,
          checked_at: NOW,
          seen: true,
          flagged: false,
        })
        .execute();
      const unchecked = await setupBox(trx);
      const uncheckedMail = await addReplyMail(trx, unchecked, { headers: false });
      const oauth = await setupBox(trx);
      const oauthMail = await addReplyMail(trx, oauth);
      await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", oauth.mailboxId).execute();

      for (const [box, mail, reason] of [
        [flagged, flaggedMail, "suspicious"],
        [answered, answeredMail, "answered"],
        [unchecked, uncheckedMail, "not_checked"],
        [oauth, oauthMail, "oauth_mailbox"],
      ] as const) {
        const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
        const id = await queueRequest(trx, box, mail, "tap");
        await runJob(jobDeps(trx, llm, fresh()), box);
        expect([reason, (await requestOf(trx, id)).status, (await requestOf(trx, id)).reason_code]).toEqual([
          reason,
          "cancelled",
          reason,
        ]);
        expect(requests).toHaveLength(0);
        expect(await pairRows(trx, box)).toEqual([]);
      }
    });
  });

  test("11b. the send is rejected while the model works: no new version, cancelled / closed", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const emailId = await addReplyMail(trx, s);
      const jobs0 = createReplyJobs(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, clock));
      await jobs0.drafter.run({ mailboxId: s.mailboxId });
      const [first] = await openReplySends(trx, s);
      const redraft = await queueRequest(trx, s, emailId, "redraft", { previousSendId: first?.id ?? null });
      const { llm } = fakeLlm(async () => {
        await reject(
          { db: trx, hooks: noDelegationHooks, approvalHooks: noApprovalHooks, uidplus: async () => true },
          s.ctx,
          first?.id ?? "",
          { userId: s.userId, via: "cli", now: clock.now }
        );
        return CLEAN_ANSWER;
      });
      await createReplyJobs(jobDeps(trx, llm, clock)).drafter.run({ mailboxId: s.mailboxId });

      expect(await requestOf(trx, redraft)).toMatchObject({ status: "cancelled", reason_code: "closed" });
      expect(await openReplySends(trx, s)).toEqual([]);
      expect(await pairRows(trx, s)).toHaveLength(2);
    });
  });

  test("12. a tap request with soft errors for 11 minutes: released in 5 min with no try counted, then failed / timeout", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      const mail = await addReplyMail(trx, s, { category: "info" });
      const { llm, requests } = fakeLlm(() => new LlmSoftError("http_503", "fake-drafter"));
      const id = await queueRequest(trx, s, mail, "tap", { nextAttemptAt: NOW });
      const secondMail = await addReplyMail(trx, s, { category: "info" });
      const second = await queueRequest(trx, s, secondMail, "tap", { at: new Date(NOW.getTime() + 1) });
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));

      await jobs.drafter.run({ mailboxId: s.mailboxId });
      // The soft error paused the job: the second request of the batch made no call and is back with its time and no try counted.
      expect(requests).toHaveLength(1);
      expect(await requestOf(trx, second)).toMatchObject({ status: "pending", attempts: 0 });
      expect((await requestOf(trx, second)).next_attempt_at.getTime()).toBe(NOW.getTime() + 1);
      expect(await requestOf(trx, id)).toMatchObject({ status: "pending", attempts: 0 });
      expect((await requestOf(trx, id)).next_attempt_at.getTime()).toBe(NOW.getTime() + 5 * MINUTE_MS);
      expect((await llmCallRows(trx, s)).map((row) => row.reason_code)).toEqual(["http_503"]);

      clock.now = new Date(NOW.getTime() + 6 * MINUTE_MS);
      await jobs.drafter.run({ mailboxId: s.mailboxId });
      expect(await requestOf(trx, id)).toMatchObject({ status: "pending", attempts: 0 });
      expect(requests).toHaveLength(2);

      // The pause of the soft error is still on: no run takes the requests, and they end in time.
      clock.now = new Date(NOW.getTime() + 11 * MINUTE_MS);
      const last = await jobs.drafter.run({ mailboxId: s.mailboxId });
      expect(last.timedOut).toBe(2);
      expect(await requestOf(trx, id)).toMatchObject({ status: "failed", reason_code: "timeout" });
      expect(requests).toHaveLength(2);
    });
  });

  test("12b. a stale drafting tap request that is 11 minutes old: failed / timeout at the claim, no call", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const mail = await addReplyMail(trx, s, { category: "info" });
      const id = await queueRequest(trx, s, mail, "redraft");
      await trx
        .updateTable("reply_requests")
        .set({
          status: "drafting",
          locked_at: new Date(NOW.getTime() - 6 * MINUTE_MS),
          created_at: new Date(NOW.getTime() - 11 * MINUTE_MS),
        })
        .where("id", "=", id)
        .execute();
      const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);

      await runJob(jobDeps(trx, llm, fresh()), s);

      expect(await requestOf(trx, id)).toMatchObject({ status: "failed", reason_code: "timeout" });
      expect(requests).toHaveLength(0);
    });
  });

  test("12c. a hard error counts a try and goes back in 5 minutes; the third ends the request llm_error; a configuration error counts none", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const clock = fresh();
      await addReplyMail(trx, s);
      const { llm } = fakeLlm(() => new LlmHardError("http_400", "fake-drafter"));
      const jobs = createReplyJobs(jobDeps(trx, llm, clock));
      const states: [string, number][] = [];
      for (let i = 0; i < 3; i += 1) {
        clock.now = new Date(NOW.getTime() + i * 6 * MINUTE_MS);
        await jobs.drafter.run({ mailboxId: s.mailboxId });
        const [request] = await requestsOf(trx, s);
        states.push([request?.status ?? "", request?.attempts ?? -1]);
      }
      expect(states).toEqual([
        ["pending", 1],
        ["pending", 2],
        ["failed", 2],
      ]);
      expect((await requestsOf(trx, s))[0]?.reason_code).toBe("llm_error");

      const other = await setupBox(trx);
      await addReplyMail(trx, other);
      const config = fakeLlm(() => new LlmConfigError("http_401", "fake-drafter"));
      const pause = createLlmPause();
      await createReplyJobs(jobDeps(trx, config.llm, fresh(), { pause })).drafter.run({ mailboxId: other.mailboxId });
      expect((await requestsOf(trx, other))[0]).toMatchObject({ status: "pending", attempts: 0 });
      expect(pause.isPaused(NOW)).toBe(true);
    });
  });

  test("13. org isolation: each request holds the org and the mailbox of its mail; an org with a closed gate gets none; a log line holds no mail text", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await setupBox(trx);
      const b = await setupBox(trx);
      const off = await setupBox(trx, { switchOn: false });
      const subject = "SUBJECT-CANARY-77";
      const body = "BODY-CANARY-77 czy możemy się spotkać?";
      const sender = "canary-sender@client.test";
      const mailA = await addReplyMail(trx, a, { subject, body, from: sender, fromName: "NAME-CANARY-77" });
      const mailB = await addReplyMail(trx, b);
      await addReplyMail(trx, off);
      const answer = { ...CLEAN_ANSWER, body: "Dzień dobry,\n\nANSWER-CANARY-77, wtorek pasuje." };
      const { llm } = fakeLlm(() => answer);
      const logs = captureLogs();
      try {
        const run = await createReplyJobs(jobDeps(trx, llm, fresh())).drafter.run();
        expect(run.requested).toBe(2);
        expect(logProblems(logs.lines, [subject, body, sender, "NAME-CANARY-77", "ANSWER-CANARY-77"])).toEqual([]);
        expect(logs.lines.some((line) => line.includes("reply_drafted"))).toBe(true);
      } finally {
        logs.stop();
      }

      const requests = await trx
        .selectFrom("reply_requests")
        .select(["org_id", "mailbox_id", "email_id"])
        .where("org_id", "in", [a.ctx.orgId, b.ctx.orgId, off.ctx.orgId])
        .execute();
      expect(requests.map((row) => [row.org_id, row.mailbox_id, row.email_id]).sort()).toEqual(
        [
          [a.ctx.orgId, a.mailboxId, mailA],
          [b.ctx.orgId, b.mailboxId, mailB],
        ].sort()
      );
      // The pairs belong to the org of their mail.
      for (const box of [a, b]) expect(await pairRows(trx, box)).toHaveLength(2);
      expect(await pairRows(trx, off)).toEqual([]);
    });
  });
});
