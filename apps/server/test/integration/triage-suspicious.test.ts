import { randomUUID } from "node:crypto";

import type { Category, SuspiciousReason } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { insertDefaultSettings, insertSenderRule } from "../../src/modules/config";
import { ensureSyncFolders, insertEmailHeaders, NO_TEST_SENDERS } from "../../src/modules/mail";
import { contentFromSource } from "../../src/modules/mail/imap/capture";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import { createLlmPause, createTriageJob, insertTriageResult, noGateEvidence } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, insertDelegate, insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Suspicious reasons in triage, the known-sender context and the delegation gate (tests 1-9 of the stage file).

const db = testDb();

beforeAll(() => {
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-15T12:00:00Z");
const DAY = 24 * 3_600_000;

const reasonCodes: Record<Category, string> = {
  urgent: "newsletter",
  needs_reply: "newsletter",
  info: "newsletter",
  notification: "newsletter",
  spam: "newsletter",
  unsure: "newsletter",
  delegation: "direct_request",
};

interface FakeLlm extends LlmClient {
  calls: number;
}

function fakeLlm(category: Category, delegateId: string | null = null): FakeLlm {
  const llm = {
    calls: 0,
    modelOf: () => "fake-model",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate(req) {
      llm.calls += 1;
      const answer = {
        category,
        confidence: 0.95,
        reason_code: reasonCodes[category],
        reason: "test",
        summary: category === "delegation" ? null : "short summary",
        fields: {
          due_date: null,
          language: "en",
          delegate_id: category === "delegation" ? delegateId : null,
          task: category === "delegation" ? "Prepare the offer" : null,
          clarification: null,
        },
      };
      return {
        data: req.schema.parse(answer),
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
  } as FakeLlm;
  return llm;
}

interface Scene {
  ctx: TenantContext;
  mailboxId: string;
  orgId: string;
}

async function scene(trx: Transaction<DB>, opts: { imapHost?: string } = {}): Promise<Scene> {
  await pauseOtherMailboxes(trx);
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  if (opts.imapHost !== undefined) {
    await trx.updateTable("mailboxes").set({ imap_host: opts.imapHost }).where("id", "=", created.mailboxId).execute();
  }
  return { ctx, mailboxId: created.mailboxId, orgId: created.orgId };
}

interface HeaderOptions {
  fromName?: string | null;
  replyTo?: string[];
  authResults?: string | null;
  listId?: string | null;
  attachments?: { name: string | null; type: string }[];
}

async function insertHeaders(trx: Transaction<DB>, ctx: TenantContext, emailId: string, opts: HeaderOptions) {
  const attachments = (opts.attachments ?? []).map((item) => ({ ...item, size: 10, inline: false }));
  await trx
    .insertInto("email_headers")
    .values({
      email_id: emailId,
      org_id: ctx.orgId,
      from_name: opts.fromName ?? null,
      reply_to: opts.replyTo ?? [],
      auth_results: opts.authResults ?? null,
      list_id: opts.listId ?? null,
      attachments: JSON.stringify(attachments),
      attachment_count: attachments.length,
      parts_known: true,
      captured_at: now,
    })
    .execute();
}

// A mail that the triage job already finished: status `triaged` and one result.
async function earlierMail(
  trx: Transaction<DB>,
  s: Scene,
  from: string,
  result: {
    category: Category;
    reasons?: SuspiciousReason[];
    ageDays?: number;
    mailboxId?: string;
    ctx?: TenantContext;
  }
): Promise<string> {
  const ctx = result.ctx ?? s.ctx;
  const mailboxId = result.mailboxId ?? s.mailboxId;
  const emailId = await insertTestEmail(trx, ctx, mailboxId, {
    from_address: from,
    status: "triaged",
    received_at: new Date(now.getTime() - (result.ageDays ?? 5) * DAY),
  });
  await insertTriageResult(trx, ctx, {
    emailId,
    category: result.category,
    vip: false,
    confidence: 0.9,
    reasonCode: "test",
    reason: null,
    fields: {},
    model: "m",
    promptVersion: "classifier-v1",
    tokensIn: null,
    tokensOut: null,
    latencyMs: null,
    suspiciousReasons: result.reasons ?? [],
  });
  return emailId;
}

async function runJob(
  trx: Transaction<DB>,
  llm: LlmClient,
  opts: { trustedAuthservIds?: string[]; mode?: "shadow" | "assist" } = {}
): Promise<void> {
  await createTriageJob({
    runningKey: noGateEvidence.runningKey,
    db: trx,
    llm,
    pause: createLlmPause(),
    scope: { kind: "all" },
    batchSize: 5,
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    trustedAuthservIds: opts.trustedAuthservIds ?? [],
    now: () => now,
  }).run();
}

// One pending mail, triaged by the job; returns its stored reasons and category.
async function triaged(
  trx: Transaction<DB>,
  s: Scene,
  mail: { from: string; headers?: HeaderOptions | null },
  llm: LlmClient,
  opts: Parameters<typeof runJob>[2] = {}
) {
  const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
    from_address: mail.from,
    received_at: new Date(now.getTime() - 60_000),
  });
  if (mail.headers !== null && mail.headers !== undefined) await insertHeaders(trx, s.ctx, emailId, mail.headers);
  await runJob(trx, llm, opts);
  const result = await trx.selectFrom("triage_results").selectAll().where("email_id", "=", emailId).executeTakeFirst();
  return { emailId, result, reasons: result?.suspicious_reasons };
}

async function enableAssist(trx: Transaction<DB>, s: Scene): Promise<void> {
  await trx
    .updateTable("mailbox_settings")
    .set({
      mode: "assist",
      tool_switches: JSON.stringify({ move: true, mark_read: true, flag: true, create_draft: true, move_unsure: true }),
    })
    .where("mailbox_id", "=", s.mailboxId)
    .execute();
}

async function flag(trx: Transaction<DB>, s: Scene, enabled: boolean): Promise<void> {
  await setOrgFeature(trx, s.ctx, { flag: "suspicious_mail", enabled, actor: "cli", now });
}

describe("suspicious reasons in triage", () => {
  afterEach(() => configureFeatures({ off: [] }));

  test("1. a look-alike of a delegate domain, flag off: reasons stored, the draft and the row as today", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await enableAssist(trx, s);
      const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@paliwa-flota.test" });
      const { emailId, reasons } = await triaged(
        trx,
        s,
        { from: "billing@paliwa-fiota.test" },
        fakeLlm("delegation", delegateId)
      );
      expect(reasons).toEqual(["lookalike_domain"]);
      const actions = await listActionsForEmail(trx, s.ctx, emailId);
      expect(actions.map((a) => a.type).sort()).toEqual(["create_draft", "send"]);
      const rows = await trx.selectFrom("delegations").select("id").where("email_id", "=", emailId).execute();
      expect(rows).toHaveLength(1);
      const audit = await trx
        .selectFrom("audit_log")
        .select("data")
        .where("email_id", "=", emailId)
        .where("event", "=", "email.triaged")
        .executeTakeFirstOrThrow();
      expect(audit.data).toMatchObject({ suspicious: "lookalike_domain" });
    });
  });

  test("2. the same mail with the flag on: category delegation, no action, no delegations row, mail stays in INBOX", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await enableAssist(trx, s);
      await flag(trx, s, true);
      const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@paliwa-flota.test" });
      const { emailId, result } = await triaged(
        trx,
        s,
        { from: "billing@paliwa-fiota.test" },
        fakeLlm("delegation", delegateId)
      );
      expect(result?.category).toBe("delegation");
      expect(result?.suspicious_reasons).toEqual(["lookalike_domain"]);
      expect(await listActionsForEmail(trx, s.ctx, emailId)).toEqual([]);
      expect(await trx.selectFrom("delegations").select("id").where("email_id", "=", emailId).execute()).toEqual([]);
      const mail = await trx.selectFrom("emails").select("folder").where("id", "=", emailId).executeTakeFirstOrThrow();
      expect(mail.folder).toBe("INBOX");
    });
  });

  test("2b. the flag gates only delegation mail with reasons: an unflagged delegation mail keeps its draft", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await enableAssist(trx, s);
      await flag(trx, s, true);
      const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@paliwa-flota.test" });
      const { emailId, reasons } = await triaged(
        trx,
        s,
        { from: "jan@klient.test" },
        fakeLlm("delegation", delegateId)
      );
      expect(reasons).toEqual([]);
      expect((await listActionsForEmail(trx, s.ctx, emailId)).map((a) => a.type).sort()).toEqual([
        "create_draft",
        "send",
      ]);
    });
  });

  test("3. a whitelisted sender with run.exe, flag on, urgent: reasons {risky_attachment}, the urgent plan stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await enableAssist(trx, s);
      await flag(trx, s, true);
      await insertSenderRule(trx, s.ctx, { mailboxId: null, pattern: "boss@firma.test", kind: "whitelist" });
      const { emailId, reasons } = await triaged(
        trx,
        s,
        { from: "boss@firma.test", headers: { attachments: [{ name: "run.exe", type: "application/octet-stream" }] } },
        fakeLlm("urgent")
      );
      expect(reasons).toEqual(["risky_attachment"]);
      expect((await listActionsForEmail(trx, s.ctx, emailId)).map((a) => a.type)).toEqual(["flag"]);
    });
  });

  test("4. no email_headers row: a look-alike of a known domain is flagged, a plain unknown domain is not", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@paliwa-flota.test" });
      const lookalike = await triaged(trx, s, { from: "x@paliwa-fiota.test" }, fakeLlm("info"));
      expect(lookalike.reasons).toEqual(["lookalike_domain"]);
      const plain = await triaged(trx, s, { from: "y@plain-unknown.test" }, fakeLlm("info"));
      expect(plain.reasons).toEqual([]);
    });
  });

  test("5. a blocklisted sender with a Reply-To on another domain: spam, {reply_to_mismatch}, no LLM call", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await insertSenderRule(trx, s.ctx, { mailboxId: null, pattern: "junk@bad.test", kind: "blocklist" });
      const llm = fakeLlm("info");
      const { result } = await triaged(
        trx,
        s,
        { from: "junk@bad.test", headers: { replyTo: ["other@elsewhere.test"] } },
        llm
      );
      expect(result?.category).toBe("spam");
      expect(result?.reason_code).toBe("blocklist");
      expect(result?.suspicious_reasons).toEqual(["reply_to_mismatch"]);
      expect(llm.calls).toBe(0);
    });
  });
});

describe("a flagged delegation mail from the Junk folder (D6, review TG2)", () => {
  async function junkScene(trx: Transaction<DB>) {
    const s = await scene(trx);
    await enableAssist(trx, s);
    await ensureSyncFolders(trx, s.ctx, s.mailboxId, [{ key: "junk", path: "Junk", role: "junk" }], now);
    const delegateId = await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@paliwa-flota.test" });
    return { s, delegateId };
  }

  async function junkMail(trx: Transaction<DB>, s: Scene, from: string): Promise<string> {
    return insertTestEmail(trx, s.ctx, s.mailboxId, {
      from_address: from,
      received_at: new Date(now.getTime() - 60_000),
      source_folder: "Junk",
    });
  }

  test("R1. flag on, reasons not empty, delegation from Junk: an empty plan (no draft, no send, no row, no move)", async () => {
    await withRollback(db, async (trx) => {
      const { s, delegateId } = await junkScene(trx);
      await flag(trx, s, true);
      const emailId = await junkMail(trx, s, "billing@paliwa-fiota.test");
      await runJob(trx, fakeLlm("delegation", delegateId));
      const result = await trx
        .selectFrom("triage_results")
        .selectAll()
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(result.category).toBe("delegation");
      expect(result.suspicious_reasons).toEqual(["lookalike_domain"]);
      expect(await listActionsForEmail(trx, s.ctx, emailId)).toEqual([]);
      expect(await trx.selectFrom("delegations").select("id").where("email_id", "=", emailId).execute()).toEqual([]);
    });
  });

  test("R1b. an unflagged delegation mail from Junk keeps today's move to inbox, flag on or off", async () => {
    for (const enabled of [true, false]) {
      await withRollback(db, async (trx) => {
        const { s, delegateId } = await junkScene(trx);
        await flag(trx, s, enabled);
        const emailId = await junkMail(trx, s, "jan@klient.test");
        await runJob(trx, fakeLlm("delegation", delegateId));
        const actions = await listActionsForEmail(trx, s.ctx, emailId);
        expect(actions.map((a) => [a.type, a.payload])).toEqual([["move", { folder: "inbox" }]]);
      });
    }
  });

  test("R1c. flag off, flagged delegation mail from Junk: today's move to inbox (the flag gates the plan)", async () => {
    await withRollback(db, async (trx) => {
      const { s, delegateId } = await junkScene(trx);
      await flag(trx, s, false);
      const emailId = await junkMail(trx, s, "billing@paliwa-fiota.test");
      await runJob(trx, fakeLlm("delegation", delegateId));
      const actions = await listActionsForEmail(trx, s.ctx, emailId);
      expect(actions.map((a) => [a.type, a.payload])).toEqual([["move", { folder: "inbox" }]]);
    });
  });
});

describe("the known-sender rule (D4, review N1, N15)", () => {
  const mismatch = { replyTo: ["other@elsewhere.test"] };

  test("6a. 3 earlier unflagged info mails make the sender known: a Reply-To mismatch gives {}", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      for (let i = 0; i < 3; i++) await earlierMail(trx, s, "Partner@Shop.test", { category: "info" });
      const { reasons } = await triaged(trx, s, { from: "partner@shop.test", headers: mismatch }, fakeLlm("info"));
      expect(reasons).toEqual([]);
    });
  });

  test("6a2. 2 earlier mails are not enough", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      for (let i = 0; i < 2; i++) await earlierMail(trx, s, "partner@shop.test", { category: "info" });
      const { reasons } = await triaged(trx, s, { from: "partner@shop.test", headers: mismatch }, fakeLlm("info"));
      expect(reasons).toEqual(["reply_to_mismatch"]);
    });
  });

  test("6b. 3 spam mails then 1 info mail: not known (N15: the rule counts non-spam mails, not the latest one)", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      for (let i = 0; i < 3; i++) await earlierMail(trx, s, "partner@shop.test", { category: "spam", ageDays: 10 + i });
      await earlierMail(trx, s, "partner@shop.test", { category: "info", ageDays: 1 });
      const { reasons } = await triaged(trx, s, { from: "partner@shop.test", headers: mismatch }, fakeLlm("info"));
      expect(reasons).toEqual(["reply_to_mismatch"]);
    });
  });

  test("6c. 3 earlier info mails with {lookalike_domain}: the 4th mail is still flagged (N1)", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@paliwa-flota.test" });
      for (let i = 0; i < 3; i++) {
        await earlierMail(trx, s, "billing@paliwa-fiota.test", { category: "info", reasons: ["lookalike_domain"] });
      }
      const { reasons } = await triaged(trx, s, { from: "billing@paliwa-fiota.test" }, fakeLlm("info"));
      expect(reasons).toEqual(["lookalike_domain"]);
    });
  });

  test("6d. mail older than 90 days and mail of another organization do not count", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const sibling = await createOrgWithMailbox(trx);
      const siblingCtx: TenantContext = { orgId: sibling.orgId };
      // Old mail in this mailbox.
      await earlierMail(trx, s, "partner@shop.test", { category: "info", ageDays: 100 });
      await earlierMail(trx, s, "partner@shop.test", { category: "info", ageDays: 120 });
      await earlierMail(trx, s, "partner@shop.test", { category: "info", ageDays: 91 });
      // Recent mail of the same address in the other organization.
      for (let i = 0; i < 3; i++) {
        await earlierMail(trx, s, "partner@shop.test", {
          category: "info",
          ctx: siblingCtx,
          mailboxId: sibling.mailboxId,
        });
      }
      const { reasons } = await triaged(trx, s, { from: "partner@shop.test", headers: mismatch }, fakeLlm("info"));
      expect(reasons).toEqual(["reply_to_mismatch"]);
    });
  });

  test("6e. 3 clean mails of a sender in another mailbox of the same organization do not make it known here", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const secondId = randomUUID();
      await trx
        .insertInto("mailboxes")
        .values({
          id: secondId,
          org_id: s.orgId,
          address: `second-${randomUUID()}@x.test`,
          imap_host: "imap.x.test",
          imap_port: 993,
          smtp_host: "smtp.x.test",
          smtp_port: 465,
        })
        .execute();
      for (let i = 0; i < 3; i++)
        await earlierMail(trx, s, "partner@shop.test", { category: "info", mailboxId: secondId });
      const { reasons } = await triaged(trx, s, { from: "partner@shop.test", headers: mismatch }, fakeLlm("info"));
      expect(reasons).toEqual(["reply_to_mismatch"]);
    });
  });

  test("6f. a frequent sender never silences lookalike_domain for another sender (knownDomains holds no frequent domain)", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      for (let i = 0; i < 3; i++) await earlierMail(trx, s, "a@shop-example.test", { category: "info" });
      // Both senders are in the same batch: the frequent one is known, its domain is not.
      const frequentMail = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        from_address: "a@shop-example.test",
        received_at: new Date(now.getTime() - 120_000),
      });
      const { emailId, reasons } = await triaged(trx, s, { from: "b@shop-exampel.test" }, fakeLlm("info"));
      expect(reasons).toEqual([]);
      const frequentResult = await trx
        .selectFrom("triage_results")
        .select("suspicious_reasons")
        .where("email_id", "=", frequentMail)
        .executeTakeFirst();
      expect(frequentResult?.suspicious_reasons).toEqual([]);
      expect(emailId).not.toBe(frequentMail);
      // The same frequent domain as a known domain (an exact whitelist rule) makes the look-alike visible.
      await insertSenderRule(trx, s.ctx, { mailboxId: null, pattern: "a@shop-example.test", kind: "whitelist" });
      const flagged = await triaged(trx, s, { from: "c@shop-exampel.test" }, fakeLlm("info"));
      expect(flagged.reasons).toEqual(["lookalike_domain"]);
    });
  });
});

describe("own addresses (D4, review N16)", () => {
  test("6g. the mailbox address and its domain are known: forged own mail is known, only auth_fail can catch it", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("address")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      const mismatch = { replyTo: ["other@elsewhere.test"] };
      const own = await triaged(trx, s, { from: mailbox.address, headers: mismatch }, fakeLlm("info"));
      expect(own.reasons).toEqual([]);
      const sameDomain = await triaged(trx, s, { from: "colleague@x.test", headers: mismatch }, fakeLlm("info"));
      expect(sameDomain.reasons).toEqual([]);
      // The accepted limit: a forged own address is known. A trusted failing header still flags it.
      const forged = await triaged(
        trx,
        s,
        { from: mailbox.address, headers: { authResults: "imap.x.test; dmarc=fail" } },
        fakeLlm("info")
      );
      expect(forged.reasons).toEqual(["auth_fail"]);
    });
  });
});

describe("trusted authserv-ids (D2)", () => {
  test("7. the IMAP host domain is trusted, an unknown host is not, a configured id is", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx, { imapHost: "imap.corp.test" });
      const trusted = await triaged(
        trx,
        s,
        { from: "a@somewhere.test", headers: { authResults: "mx.corp.test; dmarc=fail" } },
        fakeLlm("info")
      );
      expect(trusted.reasons).toEqual(["auth_fail"]);
      const foreign = await triaged(
        trx,
        s,
        { from: "b@somewhere.test", headers: { authResults: "evil.test; dmarc=fail" } },
        fakeLlm("info")
      );
      expect(foreign.reasons).toEqual([]);
      const configured = await triaged(
        trx,
        s,
        { from: "c@somewhere.test", headers: { authResults: "evil.test; dmarc=fail" } },
        fakeLlm("info"),
        { trustedAuthservIds: ["evil.test"] }
      );
      expect(configured.reasons).toEqual(["auth_fail"]);
    });
  });
});

describe("forged Authentication-Results through real capture (D2, review TG1)", () => {
  const source = (...headers: string[]) =>
    Buffer.from([...headers, "From: boss@somewhere.test", "To: me@corp.test", "Subject: x", "", "hi"].join("\r\n"));

  // Real capture, the real header store, then the triage job: the same path as a synced mail.
  async function viaCapture(trx: Transaction<DB>, s: Scene, raw: Buffer): Promise<SuspiciousReason[]> {
    const content = await contentFromSource(raw);
    if (content?.capture === undefined || content.capture === null) throw new Error("no capture");
    const dedupKey = `test:${randomUUID()}`;
    const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
      from_address: "boss@somewhere.test",
      dedup_key: dedupKey,
      received_at: new Date(now.getTime() - 60_000),
    });
    expect(await insertEmailHeaders(trx, s.ctx, { mailboxId: s.mailboxId, dedupKey }, content.capture, now)).toBe(true);
    await runJob(trx, fakeLlm("info"));
    const result = await trx
      .selectFrom("triage_results")
      .select("suspicious_reasons")
      .where("email_id", "=", emailId)
      .executeTakeFirstOrThrow();
    return result.suspicious_reasons as SuspiciousReason[];
  }

  test("a trusted top header with dmarc=fail gives auth_fail; a lower forged dmarc=pass does not clear it", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx, { imapHost: "imap.corp.test" });
      const reasons = await viaCapture(
        trx,
        s,
        source(
          "Authentication-Results: mx.corp.test; dmarc=fail header.from=somewhere.test",
          "Received: from evil.test by mx.corp.test",
          "Authentication-Results: mx.corp.test; dmarc=pass spf=pass dkim=pass"
        )
      );
      expect(reasons).toEqual(["auth_fail"]);
    });
  });

  test("the ids corp.test.evil.test and evilcorp.test are not trusted for the host imap.corp.test", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx, { imapHost: "imap.corp.test" });
      for (const id of ["corp.test.evil.test", "evilcorp.test"]) {
        expect(await viaCapture(trx, s, source(`Authentication-Results: ${id}; dmarc=fail`))).toEqual([]);
      }
    });
  });
});

describe("free-mail look-alikes (D4)", () => {
  test("8. gmai1.com with a known a@gmail.com is flagged; new@gmail.com is not known and gets {}", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await insertSenderRule(trx, s.ctx, { mailboxId: null, pattern: "a@gmail.com", kind: "whitelist" });
      const lookalike = await triaged(trx, s, { from: "x@gmai1.com" }, fakeLlm("info"));
      expect(lookalike.reasons).toEqual(["lookalike_domain"]);
      const stranger = await triaged(
        trx,
        s,
        { from: "new@gmail.com", headers: { replyTo: ["z@other.test"] } },
        fakeLlm("info")
      );
      // Not known: the Reply-To rule fires. The free-mail domain does not make the sender known.
      expect(stranger.reasons).toEqual(["reply_to_mismatch"]);
      const plain = await triaged(trx, s, { from: "other@gmail.com" }, fakeLlm("info"));
      expect(plain.reasons).toEqual([]);
    });
  });

  test("8b. a delegate on a free-mail domain does not make that domain known", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@gmail.com" });
      const { reasons } = await triaged(
        trx,
        s,
        { from: "stranger@gmail.com", headers: { replyTo: ["z@other.test"] } },
        fakeLlm("info")
      );
      expect(reasons).toEqual(["reply_to_mismatch"]);
    });
  });
});

describe("tenant scope (test 9)", () => {
  test("9. organization B's mailboxes, delegates, rules, members and VIP names never reach organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await scene(trx);
      const b = await createOrgWithMailbox(trx, { address: "box@orgb-corp.test" });
      const bCtx: TenantContext = { orgId: b.orgId };
      await insertDelegate(trx, bCtx, { name: "Zofia Nowak", email: "zofia@orgb-delegate.test" });
      await insertSenderRule(trx, bCtx, { mailboxId: null, pattern: "vip@orgb-vip.test", kind: "vip" });
      await insertSenderRule(trx, bCtx, { mailboxId: null, pattern: "@orgb-domain.test", kind: "whitelist" });
      const user = await insertUser(trx, { email: `member-${randomUUID()}@x.test`, displayName: "Piotr Wisniewski" });
      await insertMembership(trx, bCtx, { userId: user.id, role: "owner" });

      // Each sender is known in B only. In A each one is unknown, so the Reply-To rule fires.
      const mismatch = { replyTo: ["other@elsewhere.test"] };
      for (const from of [
        "anyone@orgb-corp.test",
        "zofia@orgb-delegate.test",
        "vip@orgb-vip.test",
        "q@orgb-domain.test",
      ]) {
        const { reasons } = await triaged(trx, a, { from, headers: mismatch }, fakeLlm("info"));
        expect(reasons).toEqual(["reply_to_mismatch"]);
      }
      // B's names are not protected in A.
      for (const fromName of ["Zofia Nowak", "Piotr Wisniewski"]) {
        const { reasons } = await triaged(trx, a, { from: "n@unknown.test", headers: { fromName } }, fakeLlm("info"));
        expect(reasons).toEqual([]);
      }
    });
  });

  test("9b. A's own delegate, member and VIP names are protected", async () => {
    await withRollback(db, async (trx) => {
      const a = await scene(trx);
      await insertDelegate(trx, a.ctx, { name: "Zofia Nowak", email: "zofia@a-delegate.test" });
      const user = await insertUser(trx, { email: `member-${randomUUID()}@x.test`, displayName: "Piotr Wisniewski" });
      await insertMembership(trx, a.ctx, { userId: user.id, role: "owner" });
      await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "ceo@a-vip.test", kind: "vip" });
      const vipMail = await insertTestEmail(trx, a.ctx, a.mailboxId, {
        from_address: "ceo@a-vip.test",
        status: "triaged",
        received_at: new Date(now.getTime() - 3 * DAY),
      });
      await insertHeaders(trx, a.ctx, vipMail, { fromName: "Adam Prezes" });
      for (const fromName of ["Zofia Nowak", "Piotr Wisniewski", "Adam Prezes"]) {
        const { reasons } = await triaged(trx, a, { from: "n@unknown.test", headers: { fromName } }, fakeLlm("info"));
        expect(reasons).toEqual(["display_name_spoof"]);
      }
    });
  });

  test("9c. the VIP display name comes from this mailbox only: mail of another organization or mailbox gives no name", async () => {
    await withRollback(db, async (trx) => {
      const a = await scene(trx);
      const b = await createOrgWithMailbox(trx);
      const bCtx: TenantContext = { orgId: b.orgId };
      const secondId = randomUUID();
      await trx
        .insertInto("mailboxes")
        .values({
          id: secondId,
          org_id: a.orgId,
          address: `second-${randomUUID()}@x.test`,
          imap_host: "imap.x.test",
          imap_port: 993,
          smtp_host: "smtp.x.test",
          smtp_port: 465,
        })
        .execute();
      await insertSenderRule(trx, a.ctx, { mailboxId: null, pattern: "ceo@shared-vip.test", kind: "vip" });
      const otherOrgMail = await insertTestEmail(trx, bCtx, b.mailboxId, {
        from_address: "ceo@shared-vip.test",
        status: "triaged",
        received_at: new Date(now.getTime() - DAY),
      });
      await insertHeaders(trx, bCtx, otherOrgMail, { fromName: "Karol Obcy" });
      const otherMailboxMail = await insertTestEmail(trx, a.ctx, secondId, {
        from_address: "ceo@shared-vip.test",
        status: "triaged",
        received_at: new Date(now.getTime() - DAY),
      });
      await insertHeaders(trx, a.ctx, otherMailboxMail, { fromName: "Marek Inny" });
      for (const fromName of ["Karol Obcy", "Marek Inny"]) {
        const { reasons } = await triaged(trx, a, { from: "n@unknown.test", headers: { fromName } }, fakeLlm("info"));
        expect(reasons).toEqual([]);
      }
    });
  });
});
