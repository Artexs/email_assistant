import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { listActionsForEmail } from "../../src/modules/actions";
import { claimEmails } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { triageOne } from "../../src/modules/triage";
import { LlmSoftError, type LlmClient } from "../../src/platform/llm";

import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  now,
  setup,
  results,
  audit,
  emailStatus,
  fakeLlm,
  analysis,
  fakePause,
  setupMail,
  llmRows,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("triageOne", () => {
  test("an info mail is triaged with one ok llm.call row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "news@shop.test" });
      const llm = fakeLlm(analysis());
      expect(
        await triageOne(
          {
            db: trx,
            llm,
            pause: fakePause(),
            testMail: NO_TEST_SENDERS,
            dailyCap: 1000,
            junkDailyCap: 1000,
            now: () => now,
          },
          ctx,
          mailbox,
          email
        )
      ).toEqual({
        kind: "triaged",
      });

      expect(llm.requests).toHaveLength(1);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({
        category: "info",
        reason_code: "newsletter",
        model: "fake-model",
        prompt_version: "classifier-v2",
        tokens_in: 100,
        tokens_out: 20,
      });
      const calls = await llmRows(trx, emailId);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.reason_code).toBe("ok");
      expect(calls[0]?.data).toEqual({
        mailbox_id: mailbox.id,
        role: "classifier",
        model: "fake-model",
        endpoint: "standard",
        provider: "openai" as const,
        prompt_version: "classifier-v2",
        tokens_in: 100,
        tokens_out: 20,
        latency_ms: 300,
      });
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "email.triaged")).toHaveLength(1);
      expect(log.filter((r) => r.event === "action.planned")).toHaveLength(2);
      expect(await listActionsForEmail(trx, ctx, emailId)).toHaveLength(2);
    });
  });

  test("a blocklist sender is spam without an LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "bad@spam.test" }, [
        { pattern: "spam.test", kind: "blocklist" },
      ]);
      const llm = fakeLlm(analysis());
      expect(
        await triageOne(
          {
            db: trx,
            llm,
            pause: fakePause(),
            testMail: NO_TEST_SENDERS,
            dailyCap: 1000,
            junkDailyCap: 1000,
            now: () => now,
          },
          ctx,
          mailbox,
          email
        )
      ).toEqual({
        kind: "triaged",
      });

      expect(llm.requests).toHaveLength(0);
      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "spam", model: null, reason_code: "blocklist", confidence: 1 });
      expect(await llmRows(trx, emailId)).toHaveLength(0);
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("blocklist");
    });
  });

  test("a whitelisted sender gets an allowed list without spam", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox } = await setupMail(trx, { from_address: "boss@corp.test" }, [
        { pattern: "corp.test", kind: "whitelist" },
      ]);
      const llm = fakeLlm(analysis());
      await triageOne(
        {
          db: trx,
          llm,
          pause: fakePause(),
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => now,
        },
        ctx,
        mailbox,
        email
      );

      expect(llm.requests).toHaveLength(1);
      const system = llm.requests[0]?.system ?? "";
      const other = fakeLlm(analysis());
      const plain = await setupMail(trx, { from_address: "someone@else.test" });
      await triageOne(
        {
          db: trx,
          llm: other,
          pause: fakePause(),
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => now,
        },
        plain.ctx,
        plain.mailbox,
        plain.email
      );
      expect(other.requests[0]?.system).not.toBe(system);
      expect(other.requests[0]?.system).toContain("spam");
      expect(system).not.toContain("spam");
    });
  });

  test("confidence below the threshold gives unsure with the below_threshold code", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = fakeLlm(analysis({ confidence: 0.5, reason_code: "fyi" }));
      await triageOne(
        {
          db: trx,
          llm,
          pause: fakePause(),
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => now,
        },
        ctx,
        mailbox,
        email
      );

      const [row] = await results(trx, emailId);
      expect(row).toMatchObject({ category: "unsure", reason_code: "fyi", confidence: 0.5 });
      expect(row?.fields).toMatchObject({ model_category: "info" });
      const triaged = (await audit(trx, emailId)).find((r) => r.event === "email.triaged");
      expect(triaged?.reason_code).toBe("below_threshold");
    });
  });

  // The endpoint is in every `llm.call` row. The error branch has no usage: it asks the client.
  test("an own endpoint: the ok row and the error row both say `own`", async () => {
    await withRollback(db, async (trx) => {
      const ok = await setupMail(trx, { from_address: "news@shop.test" });
      const deps = (llm: LlmClient) => ({
        db: trx,
        llm,
        pause: fakePause(),
        testMail: NO_TEST_SENDERS,
        dailyCap: 1000,
        junkDailyCap: 1000,
        now: () => now,
      });
      await triageOne(deps(fakeLlm(analysis(), "own")), ok.ctx, ok.mailbox, ok.email);
      expect(
        (await llmRows(trx, ok.emailId)).map((r) => [r.reason_code, (r.data as { endpoint?: string }).endpoint])
      ).toEqual([["ok", "own"]]);

      const failed = await setupMail(trx);
      await triageOne(
        deps(fakeLlm(new LlmSoftError("http_503", "fake-model"), "own")),
        failed.ctx,
        failed.mailbox,
        failed.email
      );
      expect(
        (await llmRows(trx, failed.emailId)).map((r) => [r.reason_code, (r.data as { endpoint?: string }).endpoint])
      ).toEqual([["http_503", "own"]]);
    });
  });

  test("older mails of the thread reach the prompt oldest first", async () => {
    await withRollback(db, async (trx) => {
      const threadKey = "thread:order";
      const base = await setup(trx);
      const markers = [
        ["FIRST-MARKER", "2026-11-05T08:00:00Z"],
        ["SECOND-MARKER", "2026-11-05T09:00:00Z"],
        ["THIRD-MARKER", "2026-11-05T10:00:00Z"],
      ] as const;
      for (const [index, [marker, at]] of markers.entries()) {
        await insertTestEmail(trx, base.ctx, base.mailbox.id, {
          thread_key: threadKey,
          message_id_header: `<order-${index}@corp.test>`,
          body_text: marker,
          received_at: new Date(at),
          status: "triaged",
        });
      }
      const currentId = await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<order-current@corp.test>",
        body_text: "current",
        received_at: new Date("2026-11-05T11:00:00Z"),
      });
      const claimed = await claimEmails(trx, base.ctx, base.mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * MINUTE_MS),
        syntheticOnly: false,
      });
      const email = claimed.find((row) => row.id === currentId);
      if (!email) throw new Error("claim failed");
      const llm = fakeLlm(analysis());
      await triageOne(
        {
          db: trx,
          llm,
          pause: fakePause(),
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => now,
        },
        base.ctx,
        base.mailbox,
        email
      );

      const prompt = llm.requests[0]?.prompt ?? "";
      const positions = markers.map(([marker]) => prompt.indexOf(marker));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect(positions[0]).toBeLessThan(positions[1] ?? -1);
      expect(positions[1]).toBeLessThan(positions[2] ?? -1);
    });
  });

  test("a synthetic mail does not see real mail of its thread", async () => {
    await withRollback(db, async (trx) => {
      const threadKey = "thread:shared";
      const base = await setup(trx);
      await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<real@corp.test>",
        body_text: "REAL-MARKER-XYZ",
        received_at: new Date("2026-11-05T10:00:00Z"),
        status: "triaged",
      });
      await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<old@ea-seed.test>",
        body_text: "SYNTH-MARKER-ABC",
        received_at: new Date("2026-11-05T09:00:00Z"),
        status: "triaged",
      });
      const currentId = await insertTestEmail(trx, base.ctx, base.mailbox.id, {
        thread_key: threadKey,
        message_id_header: "<a@ea-seed.test>",
        body_text: "current",
        received_at: new Date("2026-11-05T11:00:00Z"),
      });
      const claimed = await claimEmails(trx, base.ctx, base.mailbox.id, {
        now,
        limit: 10,
        staleBefore: new Date(now.getTime() - 5 * MINUTE_MS),
        syntheticOnly: { testMail: NO_TEST_SENDERS },
      });
      const email = claimed.find((row) => row.id === currentId);
      if (!email) throw new Error("claim failed");
      const llm = fakeLlm(analysis());
      await triageOne(
        {
          db: trx,
          llm,
          pause: fakePause(),
          testMail: NO_TEST_SENDERS,
          dailyCap: 1000,
          junkDailyCap: 1000,
          now: () => now,
        },
        base.ctx,
        base.mailbox,
        email
      );

      const prompt = llm.requests[0]?.prompt ?? "";
      expect(prompt).not.toContain("REAL-MARKER-XYZ");
      expect(prompt).toContain("SYNTH-MARKER-ABC");
    });
  });
});
