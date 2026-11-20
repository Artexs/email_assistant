import { randomUUID } from "node:crypto";

import { MINUTE_MS, DAY_MS } from "@ea/core";
import type { SenderRule, SuspiciousReason } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { insertMailbox } from "../../src/modules/mail/repo";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { assessEmail, insertTriageResult, loadSuspiciousContext, resetSentDomainCache } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertTestEmail,
  pauseOtherMailboxes,
  seedSenderActivity,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// A domain that the user wrote to adds look-alike targets. It never exempts itself and never makes its sender known: the
// user may have mistyped an address (a reply-all with a typo-squat in Cc), and the typo-squat must still get every check.

const db = testDb();

beforeAll(() => {
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  configureFeatures({ off: [] });
  resetSentDomainCache();
});

const now = new Date("2026-11-18T10:00:00Z");
const ago = (days: number): Date => new Date(now.getTime() - days * DAY_MS);

const vip: SenderRule[] = [{ kind: "vip", pattern: "ceo@acmecorp.pl" }];

interface Scene {
  ctx: TenantContext;
  mailboxId: string;
}

async function scene(trx: Transaction<DB>): Promise<Scene> {
  await pauseOtherMailboxes(trx);
  const created = await createOrgWithMailbox(trx);
  const s = { ctx: { orgId: created.orgId }, mailboxId: created.mailboxId };
  await setOrgFeature(trx, s.ctx, { flag: "sender_context", enabled: true, actor: "cli", now });
  await setOrgFeature(trx, s.ctx, { flag: "suspicious_mail", enabled: true, actor: "cli", now });
  return s;
}

async function sentTo(trx: Transaction<DB>, s: Scene, to: string, days: number, times = 2) {
  for (let i = 0; i < times; i += 1) {
    await seedSenderActivity(trx, s.ctx, s.mailboxId, { sent: [{ at: ago(days), to: [to] }] });
  }
}

interface MailHeaders {
  replyTo?: string[];
  links?: { host: string; textHost: string | null }[];
}

// One mail the way the triage job treats it: the context is read for the batch, the reasons are stored as the newest result.
async function triaged(
  trx: Transaction<DB>,
  s: Scene,
  rules: SenderRule[],
  from: string,
  headers: MailHeaders = {}
): Promise<SuspiciousReason[]> {
  const id = await insertTestEmail(trx, s.ctx, s.mailboxId, {
    from_address: from,
    status: "triaged",
    received_at: new Date(now.getTime() - MINUTE_MS),
  });
  if (headers.replyTo !== undefined || headers.links !== undefined) {
    await trx
      .insertInto("email_headers")
      .values({
        email_id: id,
        org_id: s.ctx.orgId,
        reply_to: headers.replyTo ?? [],
        links: JSON.stringify(headers.links ?? []),
        link_count: (headers.links ?? []).length,
        parts_known: true,
        captured_at: now,
      })
      .execute();
  }
  const context = await loadSuspiciousContext(trx, s.ctx, {
    mailbox: { id: s.mailboxId, rules, delegates: [] },
    imapHost: "imap.x.test",
    senders: [from],
    trustedAuthservIds: [],
    now,
  });
  const reasons = await assessEmail(trx, s.ctx, context, { id, from_address: from });
  await insertTriageResult(trx, s.ctx, {
    emailId: id,
    category: "info",
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
    suspiciousReasons: reasons,
  });
  return reasons;
}

describe("a domain that the user wrote to never exempts itself", () => {
  test("A. a typo-squat of a VIP domain that the user mailed twice before its first mail still gets lookalike_domain", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, "ceo@acmec0rp.pl", 5);
      expect(await triaged(trx, s, vip, "x@acmec0rp.pl")).toContain("lookalike_domain");
    });
  });

  test("A2. the same when an incoming mail of the domain has no result row yet", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await insertTestEmail(trx, s.ctx, s.mailboxId, { from_address: "x@acmec0rp.pl", received_at: ago(3) });
      await sentTo(trx, s, "ceo@acmec0rp.pl", 5);
      expect(await triaged(trx, s, vip, "x@acmec0rp.pl")).toContain("lookalike_domain");
    });
  });

  test("A3. the same when the flagged mail is 91 days old, or sits in another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await seedSenderActivity(trx, s.ctx, s.mailboxId, {
        address: "x@acmec0rp.pl",
        mails: [{ at: ago(91), category: "info", suspicious: true }],
      });
      await sentTo(trx, s, "ceo@acmec0rp.pl", 82);
      expect(await triaged(trx, s, vip, "x@acmec0rp.pl")).toContain("lookalike_domain");

      const other = randomUUID();
      await insertMailbox(trx, s.ctx, {
        id: other,
        address: `other-${other}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await seedSenderActivity(trx, s.ctx, other, {
        address: "x@acmec0rp.pl",
        mails: [{ at: ago(3), category: "info", suspicious: true }],
      });
      expect(await triaged(trx, s, vip, "y@acmec0rp.pl")).toContain("lookalike_domain");
    });
  });

  test("H. three mails in a row do not make the typo-squat a frequent sender: the fourth gets all three reasons", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, "ceo@acmec0rp.pl", 5);
      for (let i = 0; i < 3; i += 1) expect(await triaged(trx, s, vip, "x@acmec0rp.pl")).toContain("lookalike_domain");
      const reasons = await triaged(trx, s, vip, "x@acmec0rp.pl", {
        replyTo: ["attacker@evil.test"],
        links: [{ host: "evil.test", textHost: "acmecorp.pl" }],
      });
      expect(reasons).toEqual(expect.arrayContaining(["lookalike_domain", "reply_to_mismatch", "link_mismatch"]));
    });
  });

  test("a typo that the user mailed more often than the real domain is skipped: the look-alike stays a look-alike", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, "jan@kontrahent.pl", 5, 5);
      await sentTo(trx, s, "jan@kontrahemt.pl", 5, 2);
      const context = await loadSuspiciousContext(trx, s.ctx, {
        mailbox: { id: s.mailboxId, rules: [], delegates: [] },
        imapHost: "imap.x.test",
        senders: [],
        trustedAuthservIds: [],
        now,
      });
      expect(context.sentDomains).toEqual(["kontrahent.pl"]);
      expect(await triaged(trx, s, [], "x@kontrahemt.pl")).toContain("lookalike_domain");
    });
  });

  test("a Sent-only domain exempts nobody and has no target for itself: its own mail gets no look-alike reason", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, "jan@kontrahent.pl", 5);
      expect(await triaged(trx, s, [], "jan@kontrahent.pl")).not.toContain("lookalike_domain");
    });
  });

  test("a Sent domain does not make another sender on it known, also next to a frequent sender of the domain", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, "jan@kontrahent.pl", 5);
      await seedSenderActivity(trx, s.ctx, s.mailboxId, {
        address: "jan@kontrahent.pl",
        mails: [1, 2, 3].map((day) => ({ at: ago(day), category: "info" as const })),
      });
      const context = await loadSuspiciousContext(trx, s.ctx, {
        mailbox: { id: s.mailboxId, rules: [], delegates: [] },
        imapHost: "imap.x.test",
        senders: ["jan@kontrahent.pl", "new@kontrahent.pl"],
        trustedAuthservIds: [],
        now,
      });
      // The frequent sender is known by the old rule (3 clean mails); the new address on the same domain is not.
      expect(context.isKnown("jan@kontrahent.pl")).toBe(true);
      expect(context.isKnown("new@kontrahent.pl")).toBe(false);
      expect(context.knownDomains).not.toContain("kontrahent.pl");
    });
  });
  test("a domain of the base list is not copied into the Sent list", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, "ceo@acmecorp.pl", 5);
      const context = await loadSuspiciousContext(trx, s.ctx, {
        mailbox: { id: s.mailboxId, rules: vip, delegates: [] },
        imapHost: "imap.x.test",
        senders: [],
        trustedAuthservIds: [],
        now,
      });
      expect(context.knownDomains).toContain("acmecorp.pl");
      expect(context.sentDomains).toEqual([]);
    });
  });
});
