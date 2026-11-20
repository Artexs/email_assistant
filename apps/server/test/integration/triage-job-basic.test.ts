import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { listActionsForEmail } from "../../src/modules/actions";
import { ensureSyncFolders } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import type { TenantContext } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, insertDelegate, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { now, minutesFromNow, infoAnswer, fakeLlm, job, mailboxWithSettings, emailRow } from "./triage-job-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

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
      await job(trx, llm, { kind: "all" }).run();

      expect(llm.prompts).toHaveLength(3);
      expect(llm.prompts[0]).toContain("first");
      expect(llm.prompts[1]).toContain("second");
      expect(llm.prompts[2]).toContain("third");
      for (const id of [oldest, middle, newest]) expect((await emailRow(trx, id)).status).toBe("triaged");
    });
  });

  test("a spam folder mail is planned by its source folder: spam leaves no action, INBOX spam does", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await ensureSyncFolders(trx, ctx, mailboxId, [{ key: "junk", path: "Wiadomości-śmieci", role: "junk" }], now);
      const junkMail = await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-20),
        source_folder: "Wiadomości-śmieci",
      });
      const inboxMail = await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-10) });

      const spamLlm = {
        modelOf: () => "fake-model",
        endpointOf: () => "standard",
        providerOf: () => "openai",
        async generate(req) {
          return {
            data: req.schema.parse({ ...infoAnswer, category: "spam", summary: null }),
            usage: {
              role: req.role,
              promptVersion: req.promptVersion,
              model: "fake-model",
              tokensIn: 100,
              tokensOut: 20,
              latencyMs: 300,
              endpoint: "standard",
              provider: "openai" as const,
            },
          };
        },
      } as LlmClient;
      await job(trx, spamLlm, { kind: "all" }).run();

      expect((await emailRow(trx, junkMail)).status).toBe("triaged");
      expect((await emailRow(trx, inboxMail)).status).toBe("triaged");
      expect(await listActionsForEmail(trx, ctx, junkMail)).toHaveLength(0);
      expect((await listActionsForEmail(trx, ctx, inboxMail)).length).toBeGreaterThan(0);
    });
  });

  test("the classifier gets the active delegates and the delegation category only with delegates", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const anna = await insertDelegate(trx, ctx, { name: "Anna" });
      const bob = await insertDelegate(trx, ctx, { name: "Bob" });
      await insertDelegate(trx, ctx, { name: "Cat", active: false });
      await insertTestEmail(trx, ctx, mailboxId);

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all" }).run();
      expect(llm.allowed).toHaveLength(1);
      expect(llm.allowed[0]).toHaveLength(6);
      expect(llm.allowed[0]).toContain("delegation");
      expect(llm.prompts[0]).toContain(anna);
      expect(llm.prompts[0]).toContain(bob);
      expect(llm.prompts[0]).toContain("Anna");
      expect(llm.prompts[0]).not.toContain("Cat");
    });
  });

  test("without delegates the classifier gets 5 categories and no delegate", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await insertDelegate(trx, ctx, { name: "Cat", active: false });
      await insertTestEmail(trx, ctx, mailboxId);

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all" }).run();
      expect(llm.allowed[0]).toHaveLength(5);
      expect(llm.allowed[0]).not.toContain("delegation");
    });
  });

  test("scope all: every active mailbox is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const own = await mailboxWithSettings(trx, { address: "Boss@Scope.test" });
      const other = await mailboxWithSettings(trx, { address: "other@scope.test" });
      const ownMail = await insertTestEmail(trx, own.ctx, own.mailboxId);
      const otherMail = await insertTestEmail(trx, other.ctx, other.mailboxId);

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all" }).run();

      expect(llm.prompts).toHaveLength(2);
      expect((await emailRow(trx, ownMail)).status).toBe("triaged");
      expect((await emailRow(trx, otherMail)).status).toBe("triaged");
    });
  });

  test("scope synthetic: only @ea-seed.test> mail is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      const real = await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<r@x.test>" });
      const seeded = await insertTestEmail(trx, ctx, mailboxId, { message_id_header: "<s@ea-seed.test>" });

      const llm = fakeLlm();
      await job(trx, llm, { kind: "synthetic", testMail: NO_TEST_SENDERS }).run();

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
      const triage = job(trx, llm, { kind: "synthetic", testMail: NO_TEST_SENDERS });
      await triage.run();
      await triage.run();

      const lines = errorSpy.mock.calls.filter(
        (call: unknown[]) => String(call[1]) === `triage_no_settings org_id=${bare.orgId} mailbox_id=${bare.mailboxId}`
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
      await job(trx, llm, { kind: "all" }).run();

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
      await job(trx, llm, { kind: "all" }).run();

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
