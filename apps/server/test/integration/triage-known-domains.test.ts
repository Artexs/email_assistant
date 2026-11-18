import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { sentRecipientDomains } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import { assessEmail, loadSuspiciousContext, type SuspiciousContext } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertTestEmail,
  pauseOtherMailboxes,
  seedSenderActivity,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Known domains of the look-alike rule: the registrable domains that the user wrote to (stage file tests 1-8, plus the
// reader limits and the mailbox and automatic-reply filters).

const db = testDb();

beforeAll(() => {
  configureFeatures({ off: [] });
});

afterAll(async () => {
  await db.destroy();
});

afterEach(() => configureFeatures({ off: [] }));

const now = new Date("2026-11-18T10:00:00Z");
const DAY = 24 * 3_600_000;
const ago = (days: number): Date => new Date(now.getTime() - days * DAY);

interface Scene {
  ctx: TenantContext;
  mailboxId: string;
}

async function scene(trx: Transaction<DB>): Promise<Scene> {
  await pauseOtherMailboxes(trx);
  const created = await createOrgWithMailbox(trx);
  return { ctx: { orgId: created.orgId }, mailboxId: created.mailboxId };
}

async function setFlags(trx: Transaction<DB>, s: Scene, flags: { context?: boolean; suspicious?: boolean }) {
  const set = (flag: "sender_context" | "suspicious_mail", enabled: boolean) =>
    setOrgFeature(trx, s.ctx, { flag, enabled, actor: "cli", now });
  await set("sender_context", flags.context ?? true);
  await set("suspicious_mail", flags.suspicious ?? true);
}

async function sentTo(trx: Transaction<DB>, s: Scene, to: string[], opts: { days?: number; system?: boolean } = {}) {
  await seedSenderActivity(trx, s.ctx, s.mailboxId, {
    sent: [{ at: ago(opts.days ?? 5), to, ...(opts.system === true ? { system: true } : {}) }],
  });
}

function contextOf(trx: Transaction<DB>, s: Scene): Promise<SuspiciousContext> {
  return loadSuspiciousContext(trx, s.ctx, {
    mailbox: { id: s.mailboxId, rules: [], delegates: [] },
    imapHost: "imap.x.test",
    senders: [],
    trustedAuthservIds: [],
    now,
  });
}

async function reasonsOfMail(trx: Transaction<DB>, s: Scene, from: string): Promise<string[]> {
  const context = await contextOf(trx, s);
  const id = await insertTestEmail(trx, s.ctx, s.mailboxId, { from_address: from, received_at: ago(0) });
  return assessEmail(trx, s.ctx, context, { id, from_address: from });
}

// An incoming mail from `from`, already triaged with `reasons` as its newest result.
async function incomingWith(trx: Transaction<DB>, s: Scene, from: string, reasons: string[], days = 3) {
  await seedSenderActivity(trx, s.ctx, s.mailboxId, {
    address: from,
    mails: [{ at: ago(days), category: "info", suspicious: reasons.length > 0 }],
  });
}

describe("known domains of the look-alike rule", () => {
  test("1. two Sent mails to a domain: a one-edit look-alike gets lookalike_domain", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      expect((await contextOf(trx, s)).knownDomains).toContain("kontrahent.pl");
      expect(await reasonsOfMail(trx, s, "jan@kontrahemt.pl")).toContain("lookalike_domain");
    });
  });

  test("2. with suspicious_mail off, or sender_context off, the context is as before", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const before = await contextOf(trx, s);
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      for (const flags of [{ suspicious: false }, { context: false }, { context: false, suspicious: false }]) {
        await setFlags(trx, s, flags);
        const context = await contextOf(trx, s);
        expect(context.knownDomains).toEqual(before.knownDomains);
        expect(context).toEqual({ ...before, isKnown: context.isKnown });
        expect(await reasonsOfMail(trx, s, "jan@kontrahemt.pl")).not.toContain("lookalike_domain");
      }
    });
  });

  test("3. one Sent mail is not enough", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      expect((await contextOf(trx, s)).knownDomains).not.toContain("kontrahent.pl");
      expect(await reasonsOfMail(trx, s, "jan@kontrahemt.pl")).not.toContain("lookalike_domain");
    });
  });

  test("4. a reply to a look-alike does not make its domain known", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      await incomingWith(trx, s, "x@kontrahemt.pl", ["lookalike_domain"]);
      await sentTo(trx, s, ["x@kontrahemt.pl"]);
      await sentTo(trx, s, ["x@kontrahemt.pl"]);
      const context = await contextOf(trx, s);
      expect(context.knownDomains).not.toContain("kontrahemt.pl");
      expect(context.knownDomains).toContain("kontrahent.pl");
      expect(await reasonsOfMail(trx, s, "y@kontrahemt.pl")).toContain("lookalike_domain");
    });
  });

  test("4b. a clean newest result lifts the block; a flagged mail of a subdomain blocks the registrable domain", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["a@lieferant.de"]);
      await sentTo(trx, s, ["a@lieferant.de"]);
      await sentTo(trx, s, ["b@partner.pl"]);
      await sentTo(trx, s, ["b@partner.pl"]);
      // `lieferant.de`: an old flagged result under a newer clean one does not block.
      const flagged = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        from_address: "m@lieferant.de",
        received_at: ago(4),
      });
      await trx
        .insertInto("triage_results")
        .values([
          {
            org_id: s.ctx.orgId,
            email_id: flagged,
            category: "info",
            confidence: 0.9,
            reason_code: "x",
            suspicious_reasons: ["auth_fail"],
            created_at: ago(4),
          },
          {
            org_id: s.ctx.orgId,
            email_id: flagged,
            category: "info",
            confidence: 0.9,
            reason_code: "x",
            suspicious_reasons: [],
            created_at: ago(3),
          },
        ])
        .execute();
      // `partner.pl`: a flagged mail from a subdomain blocks it.
      await incomingWith(trx, s, "m@mail.partner.pl", ["auth_fail"]);
      const known = (await contextOf(trx, s)).knownDomains;
      expect(known).toContain("lieferant.de");
      expect(known).not.toContain("partner.pl");
    });
  });

  test("4c. flagged mail older than 90 days does not block", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["a@lieferant.de"]);
      await sentTo(trx, s, ["a@lieferant.de"]);
      await incomingWith(trx, s, "m@lieferant.de", ["auth_fail"], 91);
      expect((await contextOf(trx, s)).knownDomains).toContain("lieferant.de");
    });
  });

  test("5. a free-mail domain is never added", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["x@gmail.com"]);
      await sentTo(trx, s, ["y@gmail.com"]);
      await sentTo(trx, s, ["y@gmail.com", "z@kontrahent.pl"]);
      await sentTo(trx, s, ["z@kontrahent.pl"]);
      const known = (await contextOf(trx, s)).knownDomains;
      expect(known).not.toContain("gmail.com");
      expect(known).toContain("kontrahent.pl");
    });
  });

  test("6. a 91-day-old Sent mail and a system send do not count", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["a@alt.pl"], { days: 91 });
      await sentTo(trx, s, ["a@alt.pl"], { days: 91 });
      await sentTo(trx, s, ["a@system.pl"], { system: true });
      await sentTo(trx, s, ["a@system.pl"], { system: true });
      await sentTo(trx, s, ["a@half.pl"]);
      await sentTo(trx, s, ["a@half.pl"], { days: 91 });
      await sentTo(trx, s, ["a@edge.pl"], { days: 89 });
      await sentTo(trx, s, ["a@edge.pl"], { days: 89 });
      const known = (await contextOf(trx, s)).knownDomains;
      expect(known).toContain("edge.pl");
      for (const domain of ["alt.pl", "system.pl", "half.pl"]) expect(known).not.toContain(domain);
    });
  });

  test("6b. an automatic reply does not count", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      for (let i = 0; i < 2; i += 1) {
        await seedSenderActivity(trx, s.ctx, s.mailboxId, {
          sent: [{ at: ago(2), to: ["a@urlop.pl"], autoSubmitted: "auto-replied" }],
        });
      }
      expect((await contextOf(trx, s)).knownDomains).not.toContain("urlop.pl");
    });
  });

  test("7. Sent rows of another organization or another mailbox are not in the list", async () => {
    await withRollback(db, async (trx) => {
      const a = await scene(trx);
      const b = await scene(trx);
      await setFlags(trx, a, {});
      await setFlags(trx, b, {});
      await sentTo(trx, b, ["x@fremd.pl"]);
      await sentTo(trx, b, ["x@fremd.pl"]);
      const second = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: second,
        address: `second-${second}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await sentTo(trx, { ctx: a.ctx, mailboxId: second }, ["x@zweit.pl"]);
      await sentTo(trx, { ctx: a.ctx, mailboxId: second }, ["x@zweit.pl"]);
      const known = (await contextOf(trx, a)).knownDomains;
      expect(known).not.toContain("fremd.pl");
      expect(known).not.toContain("zweit.pl");
      expect((await contextOf(trx, b)).knownDomains).toContain("fremd.pl");
    });
  });

  test("8. mail from the known domain itself gets no lookalike_domain", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      expect(await reasonsOfMail(trx, s, "jan@kontrahent.pl")).not.toContain("lookalike_domain");
      expect(await reasonsOfMail(trx, s, "new@kontrahent.pl")).not.toContain("lookalike_domain");
    });
  });

  test("9. the known-sender rule does not change: a domain the user wrote to silences nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      await sentTo(trx, s, ["jan@kontrahent.pl"]);
      const context = await contextOf(trx, s);
      expect(context.isKnown("jan@kontrahent.pl")).toBe(false);
      expect(context.isKnown("new@kontrahent.pl")).toBe(false);
    });
  });
});

describe("sentRecipientDomains", () => {
  test("registrable domains, once per mail, most mails first, minimum and limit applied", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      const since = ago(90);
      // One mail to two subdomains of one domain counts once.
      await sentTo(trx, s, ["a@x.sub1.firma.pl", "b@sub2.firma.pl"]);
      await sentTo(trx, s, ["a@sub1.firma.pl"]);
      await sentTo(trx, s, ["a@top.pl"]);
      await sentTo(trx, s, ["a@top.pl"]);
      await sentTo(trx, s, ["a@top.pl"]);
      await sentTo(trx, s, ["a@single.pl"]);
      await sentTo(trx, s, ["a@Mixed.PL", "no-at-sign", "c@"]);
      await sentTo(trx, s, ["a@mixed.pl"]);
      const all = await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since, minMails: 1, limit: 100 });
      expect(all).toEqual([
        { domain: "top.pl", mails: 3 },
        { domain: "firma.pl", mails: 2 },
        { domain: "mixed.pl", mails: 2 },
        { domain: "single.pl", mails: 1 },
      ]);
      expect(await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since, minMails: 2, limit: 100 })).toHaveLength(3);
      expect(await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since, minMails: 1, limit: 2 })).toEqual([
        { domain: "top.pl", mails: 3 },
        { domain: "firma.pl", mails: 2 },
      ]);
    });
  });

  test("a mail to both To and Cc of one domain counts once; cleared recipients count for nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await seedSenderActivity(trx, s.ctx, s.mailboxId, {
        sent: [
          { at: ago(2), to: ["a@dual.pl"], cc: ["b@dual.pl"] },
          { at: ago(2), to: [], cc: [] },
        ],
      });
      expect(await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since: ago(90), minMails: 1, limit: 10 })).toEqual([
        { domain: "dual.pl", mails: 1 },
      ]);
    });
  });
});

describe("the cap of 500 domains", () => {
  test("the context holds at most 500 Sent domains, the most mailed first", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      // 501 domains with 2 mails each, plus one with 3 mails: the one with 3 stays, one with 2 goes.
      const rows = [];
      for (let n = 0; n < 501; n += 1) {
        for (let m = 0; m < 2; m += 1) rows.push({ at: ago(2), to: [`a@firma${String(n).padStart(3, "0")}.pl`] });
      }
      for (let m = 0; m < 3; m += 1) rows.push({ at: ago(2), to: ["a@haeufig.pl"] });
      await seedSenderActivity(trx, s.ctx, s.mailboxId, { sent: rows });
      const own = (
        await loadSuspiciousContext(trx, s.ctx, {
          mailbox: { id: s.mailboxId, rules: [], delegates: [] },
          imapHost: "imap.x.test",
          senders: [],
          trustedAuthservIds: [],
          now,
        })
      ).knownDomains.filter((domain) => domain === "haeufig.pl" || domain.startsWith("firma"));
      expect(own).toHaveLength(500);
      expect(own).toContain("haeufig.pl");
      expect(own).not.toContain("firma500.pl");
    });
  });
});
