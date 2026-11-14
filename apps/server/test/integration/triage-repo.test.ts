import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  insertFeedback,
  insertTriageResult,
  latestTriageResult,
  listLabeledResults,
  listLatestTriageByEmailIds,
  listUnlabeled,
  listUsageSince,
  type TriageResultInput,
} from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
  userId: string;
}

async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId, userId: a.userId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId, userId: b.userId },
  };
}

function resultRow(emailId: string, overrides?: Partial<TriageResultInput>): TriageResultInput {
  return {
    emailId,
    category: "info",
    vip: false,
    confidence: 0.9,
    reasonCode: "llm",
    reason: "newsletter",
    fields: { lang: "pl" },
    model: "gemini-3.5-flash-lite",
    promptVersion: "classifier-v1",
    tokensIn: 120,
    tokensOut: 30,
    latencyMs: 850,
    ...overrides,
  };
}

// Rows of one transaction share now(): tests set created_at to control "latest" and "since".
async function setResultCreatedAt(trx: Transaction<DB>, id: string, minutesAgo: number): Promise<void> {
  await trx
    .updateTable("triage_results")
    .set({ created_at: sql`now() - make_interval(mins => ${minutesAgo})` })
    .where("id", "=", id)
    .execute();
}

async function setFeedbackCreatedAt(trx: Transaction<DB>, id: string, minutesAgo: number): Promise<void> {
  await trx
    .updateTable("triage_feedback")
    .set({ created_at: sql`now() - make_interval(mins => ${minutesAgo})` })
    .where("id", "=", id)
    .execute();
}

// One email per kind: a synthetic seed id (also upper case), a NULL id and a real id.
async function insertMailKinds(
  trx: Transaction<DB>,
  tenant: Tenant
): Promise<{ synthetic: string; syntheticUpper: string; nullId: string; real: string }> {
  const synthetic = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
    message_id_header: "<x@ea-seed.test>",
    received_at: new Date("2026-11-01T10:00:00Z"),
  });
  const syntheticUpper = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
    message_id_header: "<Y@EA-SEED.TEST>",
    received_at: new Date("2026-11-01T11:00:00Z"),
  });
  const nullId = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
    message_id_header: null,
    received_at: new Date("2026-11-01T12:00:00Z"),
  });
  const real = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
    message_id_header: "<r@x.test>",
    received_at: new Date("2026-11-01T13:00:00Z"),
  });
  return { synthetic, syntheticUpper, nullId, real };
}

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

describe("triage repository", () => {
  test("insertTriageResult stores the context org and fails the foreign key for another org's email", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);

      const id = await insertTriageResult(trx, a.ctx, resultRow(emailA, { vip: true }));
      const row = await trx.selectFrom("triage_results").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({
        org_id: a.ctx.orgId,
        email_id: emailA,
        category: "info",
        vip: true,
        reason_code: "llm",
        reason: "newsletter",
        fields: { lang: "pl" },
        model: "gemini-3.5-flash-lite",
        prompt_version: "classifier-v1",
        tokens_in: 120,
        tokens_out: 30,
        latency_ms: 850,
      });
      expect(row.confidence).toBeCloseTo(0.9, 5);

      await sql`savepoint cross_org_triage_result`.execute(trx);
      await expect(insertTriageResult(trx, b.ctx, resultRow(emailA))).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_triage_result`.execute(trx);
    });
  });

  test("latestTriageResult returns the newer row, and undefined for another org's context", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);

      // The newer row goes in first, so the insert order cannot decide the result.
      const newer = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailA, { category: "spam", confidence: 0.75, reasonCode: "llm", fields: { n: 2 } })
      );
      const older = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailA, { category: "urgent", reasonCode: "whitelist", model: null })
      );
      await trx
        .updateTable("triage_results")
        .set({ created_at: sql`now() - interval '1 minute'` })
        .where("id", "=", older)
        .execute();

      const latest = await latestTriageResult(trx, a.ctx, emailA);
      expect(latest).toBeDefined();
      expect(latest).toMatchObject({
        id: newer,
        category: "spam",
        reason_code: "llm",
        model: "gemini-3.5-flash-lite",
        fields: { n: 2 },
      });
      expect(latest?.confidence).toBeCloseTo(0.75, 5);

      expect(await latestTriageResult(trx, b.ctx, emailA)).toBeUndefined();
    });
  });

  test("insertFeedback stores NULL for a null true category, the given source, and the context org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);

      const rightId = await insertFeedback(trx, a.ctx, {
        emailId: emailA,
        verdict: "right",
        trueCategory: null,
        source: "cli",
        userId: null,
      });
      const wrongId = await insertFeedback(trx, a.ctx, {
        emailId: emailA,
        verdict: "wrong",
        trueCategory: "needs_reply",
        source: "telegram",
        userId: a.userId,
      });

      const rows = await trx
        .selectFrom("triage_feedback")
        .select(["id", "org_id", "email_id", "verdict", "true_category", "source", "user_id"])
        .where("email_id", "=", emailA)
        .execute();
      expect(rows.find((row) => row.id === rightId)).toEqual({
        id: rightId,
        org_id: a.ctx.orgId,
        email_id: emailA,
        verdict: "right",
        true_category: null,
        source: "cli",
        user_id: null,
      });
      expect(rows.find((row) => row.id === wrongId)).toEqual({
        id: wrongId,
        org_id: a.ctx.orgId,
        email_id: emailA,
        verdict: "wrong",
        true_category: "needs_reply",
        source: "telegram",
        user_id: a.userId,
      });

      await sql`savepoint cross_org_feedback`.execute(trx);
      await expect(
        insertFeedback(trx, b.ctx, {
          emailId: emailA,
          verdict: "right",
          trueCategory: null,
          source: "web",
          userId: null,
        })
      ).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_feedback`.execute(trx);
    });
  });

  test("list functions never read rows of another org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId, { message_id_header: "<a@x.test>" });
      const labeledA = await insertTestEmail(trx, a.ctx, a.mailboxId, { message_id_header: "<la@x.test>" });
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId, { message_id_header: "<b@x.test>" });
      const labeledB = await insertTestEmail(trx, b.ctx, b.mailboxId, { message_id_header: "<lb@x.test>" });
      for (const [ctx, emailId] of [
        [a.ctx, emailA],
        [a.ctx, labeledA],
        [b.ctx, emailB],
        [b.ctx, labeledB],
      ] as const) {
        const id = await insertTriageResult(trx, ctx, resultRow(emailId));
        await setResultCreatedAt(trx, id, 1);
      }
      await insertFeedback(trx, a.ctx, {
        emailId: labeledA,
        verdict: "right",
        trueCategory: null,
        source: "cli",
        userId: null,
      });
      await insertFeedback(trx, b.ctx, {
        emailId: labeledB,
        verdict: "right",
        trueCategory: null,
        source: "cli",
        userId: null,
      });
      const since = new Date(Date.now() - 60 * 60 * 1000);

      // Another org's context with org A's mailbox id reads nothing.
      expect(
        await listUnlabeled(trx, b.ctx, a.mailboxId, { limit: 10, mail: "real", testMail: NO_TEST_SENDERS })
      ).toEqual([]);
      expect(await listLabeledResults(trx, b.ctx, a.mailboxId, { mail: "real", testMail: NO_TEST_SENDERS })).toEqual(
        []
      );
      expect(await listUsageSince(trx, b.ctx, a.mailboxId, since, { mail: "real", testMail: NO_TEST_SENDERS })).toEqual(
        []
      );

      // Each org reads only its own rows.
      expect(
        (await listUnlabeled(trx, a.ctx, a.mailboxId, { limit: 10, mail: "real", testMail: NO_TEST_SENDERS })).map(
          (r) => r.email_id
        )
      ).toEqual([emailA]);
      expect(
        (await listUnlabeled(trx, b.ctx, b.mailboxId, { limit: 10, mail: "real", testMail: NO_TEST_SENDERS })).map(
          (r) => r.email_id
        )
      ).toEqual([emailB]);
      expect(
        (await listLabeledResults(trx, a.ctx, a.mailboxId, { mail: "real", testMail: NO_TEST_SENDERS })).map(
          (r) => r.email_id
        )
      ).toEqual([labeledA]);
      expect(
        (await listLabeledResults(trx, b.ctx, b.mailboxId, { mail: "real", testMail: NO_TEST_SENDERS })).map(
          (r) => r.email_id
        )
      ).toEqual([labeledB]);
      expect(
        await listUsageSince(trx, a.ctx, a.mailboxId, since, { mail: "real", testMail: NO_TEST_SENDERS })
      ).toHaveLength(2);
      expect(
        await listUsageSince(trx, b.ctx, b.mailboxId, since, { mail: "real", testMail: NO_TEST_SENDERS })
      ).toHaveLength(2);
    });
  });

  test("listUnlabeled: seed mail only with mail synthetic, a NULL Message-ID counts as real", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const kinds = await insertMailKinds(trx, a);
      for (const emailId of Object.values(kinds)) {
        await insertTriageResult(trx, a.ctx, resultRow(emailId));
      }

      const real = await listUnlabeled(trx, a.ctx, a.mailboxId, { limit: 10, mail: "real", testMail: NO_TEST_SENDERS });
      expect(real.map((r) => r.email_id)).toEqual([kinds.real, kinds.nullId]);
      const synthetic = await listUnlabeled(trx, a.ctx, a.mailboxId, {
        limit: 10,
        mail: "synthetic",
        testMail: NO_TEST_SENDERS,
      });
      expect(synthetic.map((r) => r.email_id)).toEqual([kinds.syntheticUpper, kinds.synthetic]);
    });
  });

  test("listLabeledResults: seed mail only with mail synthetic, a NULL Message-ID counts as real", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const kinds = await insertMailKinds(trx, a);
      for (const emailId of Object.values(kinds)) {
        await insertTriageResult(trx, a.ctx, resultRow(emailId));
        await insertFeedback(trx, a.ctx, {
          emailId,
          verdict: "right",
          trueCategory: null,
          source: "cli",
          userId: null,
        });
      }

      const real = await listLabeledResults(trx, a.ctx, a.mailboxId, { mail: "real", testMail: NO_TEST_SENDERS });
      expect(sortedIds(real.map((r) => r.email_id))).toEqual(sortedIds([kinds.real, kinds.nullId]));
      const synthetic = await listLabeledResults(trx, a.ctx, a.mailboxId, {
        mail: "synthetic",
        testMail: NO_TEST_SENDERS,
      });
      expect(sortedIds(synthetic.map((r) => r.email_id))).toEqual(sortedIds([kinds.synthetic, kinds.syntheticUpper]));
    });
  });

  test("listUsageSince: seed mail only with mail synthetic, a NULL Message-ID counts as real", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const kinds = await insertMailKinds(trx, a);
      // tokens_in marks the email of each usage row.
      await insertTriageResult(trx, a.ctx, resultRow(kinds.synthetic, { tokensIn: 101 }));
      await insertTriageResult(trx, a.ctx, resultRow(kinds.syntheticUpper, { tokensIn: 102 }));
      await insertTriageResult(trx, a.ctx, resultRow(kinds.nullId, { tokensIn: 103 }));
      await insertTriageResult(trx, a.ctx, resultRow(kinds.real, { tokensIn: 104 }));
      const since = new Date(Date.now() - 60 * 60 * 1000);

      const real = await listUsageSince(trx, a.ctx, a.mailboxId, since, { mail: "real", testMail: NO_TEST_SENDERS });
      expect(real.map((r) => r.tokens_in).sort()).toEqual([103, 104]);
      const synthetic = await listUsageSince(trx, a.ctx, a.mailboxId, since, {
        mail: "synthetic",
        testMail: NO_TEST_SENDERS,
      });
      expect(synthetic.map((r) => r.tokens_in).sort()).toEqual([101, 102]);
    });
  });

  test("listUnlabeled drops emails with feedback, returns the latest result, newest mail first, up to the limit", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const older = await insertTestEmail(trx, a.ctx, a.mailboxId, { received_at: new Date("2026-11-01T08:00:00Z") });
      const newer = await insertTestEmail(trx, a.ctx, a.mailboxId, { received_at: new Date("2026-11-02T08:00:00Z") });
      const labeled = await insertTestEmail(trx, a.ctx, a.mailboxId, { received_at: new Date("2026-11-03T08:00:00Z") });
      // The newest email has no triage result, so it is not in the list.
      await insertTestEmail(trx, a.ctx, a.mailboxId, { received_at: new Date("2026-11-04T08:00:00Z") });

      // The newer result of `older` goes in first, so the insert order cannot decide the result.
      const latestOfOlder = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(older, { category: "spam", confidence: 0.6, reasonCode: "llm", fields: { n: 2 } })
      );
      const firstOfOlder = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(older, { category: "urgent", fields: { n: 1 } })
      );
      await setResultCreatedAt(trx, latestOfOlder, 1);
      await setResultCreatedAt(trx, firstOfOlder, 5);
      await insertTriageResult(trx, a.ctx, resultRow(newer, { category: "notification" }));
      await insertTriageResult(trx, a.ctx, resultRow(labeled));
      await insertFeedback(trx, a.ctx, {
        emailId: labeled,
        verdict: "right",
        trueCategory: null,
        source: "cli",
        userId: null,
      });

      const rows = await listUnlabeled(trx, a.ctx, a.mailboxId, { limit: 10, mail: "real", testMail: NO_TEST_SENDERS });
      expect(rows.map((r) => r.email_id)).toEqual([newer, older]);
      const olderRow = rows.find((r) => r.email_id === older);
      expect(olderRow).toMatchObject({ category: "spam", reason_code: "llm", fields: { n: 2 } });
      expect(olderRow?.confidence).toBeCloseTo(0.6, 5);
      expect(olderRow?.received_at).toEqual(new Date("2026-11-01T08:00:00Z"));

      const limited = await listUnlabeled(trx, a.ctx, a.mailboxId, {
        limit: 1,
        mail: "real",
        testMail: NO_TEST_SENDERS,
      });
      expect(limited.map((r) => r.email_id)).toEqual([newer]);
    });
  });

  describe("test mail by sender (F097)", () => {
    const rule = { senders: ["ea-testmail-75wd@agentmail.to"] };

    // A real, B from the test sender, C seeded: each has a triage result; `labeled` adds a feedback row.
    async function insertSenderKinds(
      trx: Transaction<DB>,
      tenant: Tenant,
      labeled: boolean,
      senderB = rule.senders[0]
    ) {
      const a = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
        message_id_header: "<1@mail.firma.test>",
        from_address: "boss@firma.test",
        received_at: new Date("2026-11-01T10:00:00Z"),
      });
      const b = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
        message_id_header: "<x@ses.test>",
        from_address: senderB,
        received_at: new Date("2026-11-01T11:00:00Z"),
      });
      const c = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
        message_id_header: "<c@ea-seed.test>",
        from_address: "seed@firma.test",
        received_at: new Date("2026-11-01T12:00:00Z"),
      });
      for (const emailId of [a, b, c]) {
        await insertTriageResult(trx, tenant.ctx, resultRow(emailId));
        if (labeled) {
          await insertFeedback(trx, tenant.ctx, {
            emailId,
            verdict: "right",
            trueCategory: null,
            source: "cli",
            userId: null,
          });
        }
      }
      return { a, b, c };
    }

    test("real readers leave out the test sender; synthetic readers take it", async () => {
      await withRollback(db, async (trx) => {
        const { a: tenant } = await createTwoTenants(trx);
        const { a, b, c } = await insertSenderKinds(trx, tenant, true);
        const ids = async (mail: "real" | "synthetic", testMail: { senders: readonly string[] }) =>
          sortedIds(
            (await listLabeledResults(trx, tenant.ctx, tenant.mailboxId, { mail, testMail })).map((r) => r.email_id)
          );
        expect(await ids("real", rule)).toEqual(sortedIds([a]));
        expect(await ids("synthetic", rule)).toEqual(sortedIds([b, c]));
        expect(await ids("real", NO_TEST_SENDERS)).toEqual(sortedIds([a, b]));
      });
    });

    test("listUnlabeled and listUsageSince follow the same rule", async () => {
      await withRollback(db, async (trx) => {
        const { a: tenant } = await createTwoTenants(trx);
        const { a, b, c } = await insertSenderKinds(trx, tenant, false);
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const unlabeled = async (mail: "real" | "synthetic", testMail: { senders: readonly string[] }) =>
          sortedIds(
            (await listUnlabeled(trx, tenant.ctx, tenant.mailboxId, { limit: 10, mail, testMail })).map(
              (r) => r.email_id
            )
          );
        expect(await unlabeled("real", rule)).toEqual(sortedIds([a]));
        expect(await unlabeled("synthetic", rule)).toEqual(sortedIds([b, c]));
        expect(await unlabeled("real", NO_TEST_SENDERS)).toEqual(sortedIds([a, b]));
        const usage = async (mail: "real" | "synthetic") =>
          (await listUsageSince(trx, tenant.ctx, tenant.mailboxId, since, { mail, testMail: rule })).length;
        expect(await usage("real")).toBe(1);
        expect(await usage("synthetic")).toBe(2);
      });
    });

    test("the sender compare is lower case", async () => {
      await withRollback(db, async (trx) => {
        const { a: tenant } = await createTwoTenants(trx);
        const { a, b, c } = await insertSenderKinds(trx, tenant, true, "EA-TestMail-75wd@AgentMail.to");
        const real = await listLabeledResults(trx, tenant.ctx, tenant.mailboxId, { mail: "real", testMail: rule });
        expect(real.map((r) => r.email_id)).toEqual([a]);
        const synthetic = await listLabeledResults(trx, tenant.ctx, tenant.mailboxId, {
          mail: "synthetic",
          testMail: rule,
        });
        expect(sortedIds(synthetic.map((r) => r.email_id))).toEqual(sortedIds([b, c]));
      });
    });

    test("a NULL sender with a real Message-ID is real under any rule", async () => {
      await withRollback(db, async (trx) => {
        const { a: tenant } = await createTwoTenants(trx);
        const emailId = await insertTestEmail(trx, tenant.ctx, tenant.mailboxId, {
          message_id_header: "<n@x.test>",
          from_address: null,
        });
        await insertTriageResult(trx, tenant.ctx, resultRow(emailId));
        for (const testMail of [rule, NO_TEST_SENDERS]) {
          const real = await listUnlabeled(trx, tenant.ctx, tenant.mailboxId, { limit: 10, mail: "real", testMail });
          expect(real.map((r) => r.email_id)).toEqual([emailId]);
          const synthetic = await listUnlabeled(trx, tenant.ctx, tenant.mailboxId, {
            limit: 10,
            mail: "synthetic",
            testMail,
          });
          expect(synthetic).toEqual([]);
        }
      });
    });
  });

  test("listLabeledResults takes the latest result and the latest feedback per email", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const unlabeled = await insertTestEmail(trx, a.ctx, a.mailboxId);

      // Newer rows go in first, so the insert order cannot decide the result.
      const latestResult = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailId, { category: "needs_reply", confidence: 0.7, model: "gemini-3.8-flash", fields: { n: 2 } })
      );
      const oldResult = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailId, { category: "info", fields: { n: 1 } })
      );
      await setResultCreatedAt(trx, latestResult, 1);
      await setResultCreatedAt(trx, oldResult, 5);
      await insertTriageResult(trx, a.ctx, resultRow(unlabeled));

      const latestFeedback = await insertFeedback(trx, a.ctx, {
        emailId,
        verdict: "wrong",
        trueCategory: "urgent",
        source: "cli",
        userId: null,
      });
      const oldFeedback = await insertFeedback(trx, a.ctx, {
        emailId,
        verdict: "right",
        trueCategory: null,
        source: "cli",
        userId: null,
      });
      await setFeedbackCreatedAt(trx, latestFeedback, 1);
      await setFeedbackCreatedAt(trx, oldFeedback, 5);

      const rows = await listLabeledResults(trx, a.ctx, a.mailboxId, { mail: "real", testMail: NO_TEST_SENDERS });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        email_id: emailId,
        category: "needs_reply",
        reason_code: "llm",
        model: "gemini-3.8-flash",
        fields: { n: 2 },
        verdict: "wrong",
        true_category: "urgent",
      });
      expect(rows[0]?.confidence).toBeCloseTo(0.7, 5);
    });
  });

  test("listUsageSince skips rows with no model and rows before since", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const emailId = await insertTestEmail(trx, a.ctx, a.mailboxId);

      const kept = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailId, { tokensIn: 200, tokensOut: 40, latencyMs: 900 })
      );
      const noModel = await insertTriageResult(
        trx,
        a.ctx,
        resultRow(emailId, { reasonCode: "whitelist", model: null })
      );
      const tooOld = await insertTriageResult(trx, a.ctx, resultRow(emailId, { tokensIn: 999 }));
      await setResultCreatedAt(trx, kept, 10);
      await setResultCreatedAt(trx, noModel, 10);
      await setResultCreatedAt(trx, tooOld, 120);
      const since = new Date(Date.now() - 60 * 60 * 1000);

      const rows = await listUsageSince(trx, a.ctx, a.mailboxId, since, { mail: "real", testMail: NO_TEST_SENDERS });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        model: "gemini-3.5-flash-lite",
        tokens_in: 200,
        tokens_out: 40,
        latency_ms: 900,
      });
      expect(rows[0]?.created_at).toBeInstanceOf(Date);
    });
  });

  test("listLatestTriageByEmailIds returns the newest result per email, only for the org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const emailA = await insertTestEmail(trx, a.ctx, a.mailboxId);
      const emailB = await insertTestEmail(trx, b.ctx, b.mailboxId);
      const older = await insertTriageResult(trx, a.ctx, resultRow(emailA, { category: "info" }));
      const newer = await insertTriageResult(trx, a.ctx, resultRow(emailA, { category: "spam" }));
      await insertTriageResult(trx, b.ctx, resultRow(emailB));
      await setResultCreatedAt(trx, older, 10);
      await setResultCreatedAt(trx, newer, 1);

      const rows = await listLatestTriageByEmailIds(trx, a.ctx, [emailA, emailB]);
      expect(rows.map((r) => [r.email_id, r.category, r.prompt_version])).toEqual([[emailA, "spam", "classifier-v1"]]);
      expect(await listLatestTriageByEmailIds(trx, a.ctx, [])).toEqual([]);
    });
  });
});
