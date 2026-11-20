import { randomBytes, randomUUID } from "node:crypto";

import { nextQuotaDayStart, QUOTA_TIMEZONE, HOUR_MS, MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  createCommitterJob,
  createPlanned,
  reject,
  replaceApproval,
  noApprovalHooks,
  noDelegationHooks,
} from "../../src/modules/actions";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { composeMessage } from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { createFakeMailSender } from "../../src/modules/mail/fake/sender";
import { insertCredentials } from "../../src/modules/mail/repo";
import { createReplyJobs } from "../../src/modules/replies";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";
import { LlmConfigError, LlmHardError, LlmSoftError } from "../../src/platform/llm";
import { captureLogs, logProblems } from "../log-capture";

import { pauseOtherMailboxes } from "./fixtures";
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
  seedLlmCalls,
  setSwitch,
  setupBox,
  type Clock,
  type JobBox,
} from "./reply-job-fixtures";

// The drafter job (scan, claim, call, write) against Postgres with a fake model. Every test runs in a transaction that
// is rolled back. The tests that need a real commit (the kill point, two instances at once) are in replies-drafter-committed.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);
const fresh = (): Clock => ({ now: NOW });

// The open reply sends of an organization: waiting for a tap, tapped, or going out.
async function openReplySends(trx: Transaction<DB>, box: JobBox) {
  return trx
    .selectFrom("actions")
    .selectAll()
    .where("org_id", "=", box.ctx.orgId)
    .where("type", "=", "send")
    .where("status", "in", ["awaiting_approval", "approved", "applying"])
    .execute();
}

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

describe("the drafter job: hostile data never reaches a command or a recipient (F115 stage 04 and 07 carry-over)", () => {
  test("a payload folder of hostile text is data: the draft goes to Drafts only, no move, no delete, no folder of that name", async () => {
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
      const hostile = ["INBOX; DELETE", "../other-box/INBOX", 'INBOX" DELETE "Drafts'];
      const mails: string[] = [];
      for (const folder of hostile) {
        const mail = await addReplyMail(trx, s, { category: "info" });
        mails.push(mail);
        await queueRequest(trx, s, mail, "tap", { folder });
      }
      // One mail per thread, so no reply closes another.
      await runJob(jobDeps(trx, fakeLlm(() => CLEAN_ANSWER).llm, fresh()), s);
      const drafts = (await pairRows(trx, s)).filter((row) => row.type === "create_draft");
      expect(drafts.map((row) => (row.payload as { folder: string }).folder).sort()).toEqual([...hostile].sort());

      const fake = createFakeMailProvider();
      await fake.ensureFolder("Drafts");
      await fake.ensureFolder("Sent");
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

      expect((await pairRows(trx, s)).filter((row) => row.type === "create_draft").map((row) => row.status)).toEqual([
        "applied",
        "applied",
        "applied",
      ]);
      expect(await fake.searchSinceIn("Drafts", new Date(0))).toHaveLength(3);
      for (const call of fake.folderCalls) expect(hostile).not.toContain(call.folder);
      for (const method of ["moveMessage", "transferByAppend", "deleteMessage", "setFlags"]) {
        expect(fake.calls).not.toContain(method);
      }
      expect(sender.calls).toEqual([]);
      // The mails stay where they were.
      const folders = await trx.selectFrom("emails").select("folder").where("id", "in", mails).execute();
      expect(folders.map((row) => row.folder)).toEqual(["INBOX", "INBOX", "INBOX"]);
    });
  });

  test("a sender address that is not one clean address gets no request step: cancelled / bad_recipient, no call, no pair", async () => {
    await withRollback(db, async (trx) => {
      for (const from of ["jan@x.test\r\nBcc: evil@y.test", "a@b.test, c@d.test", "Jan <jan@x.test>", "jan@x.test>"]) {
        const s = await setupBox(trx);
        await addReplyMail(trx, s, { from });
        const { llm, requests } = fakeLlm(() => CLEAN_ANSWER);
        await runJob(jobDeps(trx, llm, fresh()), s);
        const [request] = await requestsOf(trx, s);
        expect([from, request?.status, request?.reason_code]).toEqual([from, "cancelled", "bad_recipient"]);
        expect(requests).toHaveLength(0);
        expect(await pairRows(trx, s)).toEqual([]);
      }
    });
  });

  test("the writer refuses a reply pair whose recipient or folder is hostile: nothing is stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await setupBox(trx);
      const emailId = await addReplyMail(trx, s);
      const base = {
        kind: "reply",
        cc: [],
        language: "pl",
        body: "Tak.",
        request_id: "5d7b8a7e-9b7e-4e8a-9d6e-1f2d3c4b5a69",
        folder: "INBOX",
        recipients: "from",
      };
      for (const to of ["x@y.test\r\nBcc: evil@z.test", "a@b.test, c@d.test", ""]) {
        await expect(
          createPlanned(trx, s.ctx, emailId, [
            {
              type: "create_draft",
              payload: { ...base, to: [to] },
              status: "ready",
              idempotencyKey: `k:${to.length}:create_draft`,
            },
          ])
        ).rejects.toThrow();
      }
      expect(await pairRows(trx, s)).toEqual([]);
    });
  });
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
