import { randomUUID } from "node:crypto";

import { MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { insertDefaultSettings } from "../../src/modules/config";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { insertTestEmail, pauseOtherMailboxes, resumeOrg, suspendOrg, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { fakeLlm, job, mailboxWithSettings, emailRow } from "./triage-job-helpers";

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

describe("suspended organizations", () => {
  test("a suspended organization gets no claim, no prompt and no llm.call row", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await mailboxWithSettings(trx);
      const b = await mailboxWithSettings(trx);
      await suspendOrg(trx, b.orgId);
      const mailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const mailB = await insertTestEmail(trx, b.ctx, b.mailboxId);

      const llm = fakeLlm();
      await job(trx, llm, { kind: "all" }).run();

      expect(llm.prompts).toHaveLength(1);
      expect((await emailRow(trx, mailA)).status).toBe("triaged");
      expect(await emailRow(trx, mailB)).toEqual({ status: "pending", attempts: 0 });
      const calls = await trx
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", b.orgId)
        .where("event", "=", auditEvents.llmCall)
        .execute();
      expect(calls).toHaveLength(0);
    });
  });

  test("a suspend during the run stops the next mailbox of the run", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const first = await mailboxWithSettings(trx);
      // A second mailbox of the same organization.
      const secondId = randomUUID();
      await insertMailbox(trx, first.ctx, {
        id: secondId,
        address: `second-${randomUUID()}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertInboxFolder(trx, first.ctx, secondId);
      await insertDefaultSettings(trx, first.ctx, secondId);
      await insertTestEmail(trx, first.ctx, first.mailboxId);
      await insertTestEmail(trx, first.ctx, secondId);

      const llm = fakeLlm();
      const classify = llm.generate.bind(llm);
      llm.generate = (async (req) => {
        const result = await classify(req);
        await suspendOrg(trx, first.orgId);
        return result;
      }) as LlmClient["generate"];
      await job(trx, llm, { kind: "all" }).run();

      expect(llm.prompts).toHaveLength(1);
      const rows = await trx
        .selectFrom("emails")
        .select("status")
        .where("org_id", "=", first.orgId)
        .orderBy("status")
        .execute();
      expect(rows.map((row) => row.status)).toEqual(["pending", "triaged"]);
    });
  });

  describe("after a resume (D4)", () => {
    const resumedAt = new Date("2026-11-12T08:00:00Z");
    const resumedNow = new Date("2026-11-12T08:05:00Z");
    const hours = (count: number) => count * HOUR_MS;

    async function resumedMailbox(trx: Transaction<DB>, resumed: boolean) {
      await pauseOtherMailboxes(trx);
      const created = await mailboxWithSettings(trx);
      if (resumed) await resumeOrg(trx, created.orgId, resumedAt);
      return created;
    }

    async function skipState(trx: Transaction<DB>, id: string) {
      return trx.selectFrom("emails").select(["status", "skip_reason"]).where("id", "=", id).executeTakeFirstOrThrow();
    }

    test("old mail of before the pause costs no LLM call; too_old wins", async () => {
      await withRollback(db, async (trx) => {
        const { ctx, mailboxId } = await resumedMailbox(trx, true);
        const created_at = new Date(resumedAt.getTime() + MINUTE_MS);
        const backlog = await insertTestEmail(trx, ctx, mailboxId, {
          received_at: new Date(resumedAt.getTime() - hours(25)),
          created_at,
          subject: "backlog",
        });
        const recent = await insertTestEmail(trx, ctx, mailboxId, {
          received_at: new Date(resumedAt.getTime() - hours(23)),
          created_at,
          subject: "recent",
        });
        const tooOld = await insertTestEmail(trx, ctx, mailboxId, {
          received_at: new Date(resumedNow.getTime() - 8 * DAY_MS),
          created_at,
          subject: "tooold",
        });

        const llm = fakeLlm();
        await job(trx, llm, { kind: "all" }, resumedNow).run();

        expect(llm.prompts).toHaveLength(1);
        expect(llm.prompts[0]).toContain("recent");
        expect(await skipState(trx, backlog)).toEqual({ status: "skipped", skip_reason: "suspended_backlog" });
        expect((await skipState(trx, recent)).status).toBe("triaged");
        expect(await skipState(trx, tooOld)).toEqual({ status: "skipped", skip_reason: "too_old" });
        const rows = await trx
          .selectFrom("audit_log")
          .select(["email_id", "reason_code"])
          .where("org_id", "=", ctx.orgId)
          .where("event", "=", auditEvents.emailSkipped)
          .execute();
        expect(rows).toHaveLength(2);
        expect(rows.find((row) => row.email_id === backlog)?.reason_code).toBe("suspended_backlog");
        expect(rows.find((row) => row.email_id === tooOld)?.reason_code).toBe("too_old");
      });
    });

    test("without a resume, a mail of 3 days ago is triaged", async () => {
      await withRollback(db, async (trx) => {
        const { ctx, mailboxId } = await resumedMailbox(trx, false);
        const id = await insertTestEmail(trx, ctx, mailboxId, {
          received_at: new Date(resumedNow.getTime() - 3 * DAY_MS),
          created_at: resumedAt,
        });
        const llm = fakeLlm();
        await job(trx, llm, { kind: "all" }, resumedNow).run();
        expect(llm.prompts).toHaveLength(1);
        expect((await skipState(trx, id)).status).toBe("triaged");
      });
    });

    test("a backfilled mail of before the pause is triaged", async () => {
      await withRollback(db, async (trx) => {
        const { ctx, mailboxId } = await resumedMailbox(trx, true);
        const id = await insertTestEmail(trx, ctx, mailboxId, {
          received_at: new Date(resumedAt.getTime() - hours(25)),
          created_at: new Date(resumedAt.getTime() + MINUTE_MS),
          backfilled_at: resumedNow,
        });
        const llm = fakeLlm();
        await job(trx, llm, { kind: "all" }, resumedNow).run();
        expect(llm.prompts).toHaveLength(1);
        expect((await skipState(trx, id)).status).toBe("triaged");
      });
    });

    test("a mail stored after the backlog window is triaged", async () => {
      await withRollback(db, async (trx) => {
        const { ctx, mailboxId } = await resumedMailbox(trx, true);
        const later = new Date(resumedAt.getTime() + 2 * DAY_MS);
        const id = await insertTestEmail(trx, ctx, mailboxId, {
          received_at: new Date(resumedAt.getTime() - hours(25)),
          created_at: later,
        });
        const llm = fakeLlm();
        await job(trx, llm, { kind: "all" }, later).run();
        expect(llm.prompts).toHaveLength(1);
        expect((await skipState(trx, id)).status).toBe("triaged");
      });
    });
  });
});
