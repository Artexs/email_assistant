import { randomUUID } from "node:crypto";

import { MINUTE_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { KyselyPlugin, Transaction } from "kysely";

import { SENT_RECIPIENT_MAX_MAILS, sentRecipientDomains } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import {
  assessEmail,
  loadSuspiciousContext,
  resetSentDomainCache,
  type SuspiciousContext,
} from "../../src/modules/triage";
import { suspiciousSenderDomains } from "../../src/modules/triage/suspicious-repo";
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

afterEach(() => {
  configureFeatures({ off: [] });
  resetSentDomainCache();
});

const now = new Date("2026-11-18T10:00:00Z");
const ago = (days: number): Date => new Date(now.getTime() - days * DAY_MS);

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

async function sentTwice(trx: Transaction<DB>, s: Scene, to: string[]) {
  await sentTo(trx, s, to);
  await sentTo(trx, s, to);
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
      expect((await contextOf(trx, s)).sentDomains).toContain("kontrahent.pl");
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
        expect(context.sentDomains).toEqual([]);
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
      expect((await contextOf(trx, s)).sentDomains).not.toContain("kontrahent.pl");
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
      expect(context.sentDomains).not.toContain("kontrahemt.pl");
      expect(context.sentDomains).toContain("kontrahent.pl");
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
      const known = (await contextOf(trx, s)).sentDomains;
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
      expect((await contextOf(trx, s)).sentDomains).toContain("lieferant.de");
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
      const known = (await contextOf(trx, s)).sentDomains;
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
      const known = (await contextOf(trx, s)).sentDomains;
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
      expect((await contextOf(trx, s)).sentDomains).not.toContain("urlop.pl");
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
      const known = (await contextOf(trx, a)).sentDomains;
      expect(known).not.toContain("fremd.pl");
      expect(known).not.toContain("zweit.pl");
      expect((await contextOf(trx, b)).sentDomains).toContain("fremd.pl");
      // A flagged mail of the other mailbox does not block a domain of this one.
      await sentTo(trx, a, ["x@partner.pl"]);
      await sentTo(trx, a, ["x@partner.pl"]);
      await incomingWith(trx, { ctx: a.ctx, mailboxId: second }, "m@partner.pl", ["auth_fail"]);
      expect((await contextOf(trx, a)).sentDomains).toContain("partner.pl");
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

// A label per number, no two of them one edit or one look-alike apart: three letters of "abcdefgh" (512 values), written twice.
function firma(n: number): string {
  const code = [(n >> 6) & 7, (n >> 3) & 7, n & 7].map((digit) => "abcdefgh"[digit]).join("");
  return `firma${code}${code}`;
}

describe("the cap of 500 domains", () => {
  test("the context holds at most 500 Sent domains, the most mailed first", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      // 501 domains with 2 mails each, plus one with 3 mails: the one with 3 stays, one with 2 goes.
      const rows = [];
      for (let n = 0; n < 501; n += 1) {
        for (let m = 0; m < 2; m += 1) rows.push({ at: ago(2), to: [`a@${firma(n)}.pl`] });
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
      ).sentDomains.filter((domain) => domain === "haeufig.pl" || domain.startsWith("firma"));
      expect(own).toHaveLength(500);
      expect(own).toContain("haeufig.pl");
      expect(own).not.toContain(`${firma(500)}.pl`);
    });
  });
  test("flagged domains do not use up the 500 places", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      const rows = [];
      for (let n = 0; n < 500; n += 1) {
        for (let m = 0; m < 2; m += 1) rows.push({ at: ago(2), to: [`a@${firma(n)}.pl`] });
      }
      for (const name of ["phish1", "phish2", "phish3"]) {
        for (let m = 0; m < 3; m += 1) rows.push({ at: ago(2), to: [`a@${name}.pl`] });
        await incomingWith(trx, s, `x@${name}.pl`, ["lookalike_domain"]);
      }
      await seedSenderActivity(trx, s.ctx, s.mailboxId, { sent: rows });
      const known = (await contextOf(trx, s)).sentDomains;
      expect(known.filter((domain) => domain.startsWith("firma"))).toHaveLength(500);
      expect(known.filter((domain) => domain.startsWith("phish"))).toHaveLength(0);
    });
  });
});

describe("the Sent domain list in detail", () => {
  test("a domain that appears only in Cc counts", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      for (let i = 0; i < 2; i += 1) {
        await seedSenderActivity(trx, s.ctx, s.mailboxId, {
          sent: [{ at: ago(3), to: ["a@eigen.pl"], cc: ["boss@nurcc.pl"] }],
        });
      }
      expect((await contextOf(trx, s)).sentDomains).toContain("nurcc.pl");
    });
  });

  test("the 90-day edge: exactly 90 days counts, one second more does not", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["a@genau.pl"], { days: 90 });
      await sentTo(trx, s, ["a@genau.pl"], { days: 90 });
      for (let i = 0; i < 2; i += 1) {
        await seedSenderActivity(trx, s.ctx, s.mailboxId, {
          sent: [{ at: new Date(ago(90).getTime() - 1000), to: ["a@zuspaet.pl"] }],
        });
      }
      const known = (await contextOf(trx, s)).sentDomains;
      expect(known).toContain("genau.pl");
      expect(known).not.toContain("zuspaet.pl");
    });
  });

  test("a tenant of a shared hosting suffix stays apart and is no target", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTo(trx, s, ["a@alpha.herokuapp.com"]);
      await sentTo(trx, s, ["a@beta.herokuapp.com"]);
      await sentTo(trx, s, ["a@someone.github.io"]);
      await sentTo(trx, s, ["a@someone.github.io"]);
      const written = await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since: ago(90), minMails: 1, limit: 10 });
      expect(written).toEqual([
        { domain: "someone.github.io", mails: 2 },
        { domain: "alpha.herokuapp.com", mails: 1 },
        { domain: "beta.herokuapp.com", mails: 1 },
      ]);
      const known = (await contextOf(trx, s)).sentDomains;
      expect(known).toEqual([]);
    });
  });

  test("free-mail domains of the Polish and international providers are never added", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      const free = [
        "vp.pl",
        "autograf.pl",
        "onet.eu",
        "yahoo.pl",
        "outlook.pl",
        "me.com",
        "aol.com",
        "msn.com",
        "mail.com",
        "pm.me",
        "proton.me",
        "protonmail.com",
        "tutanota.com",
        "zoho.com",
        "hotmail.co.uk",
        "yahoo.co.uk",
        "gmx.com",
        "gmx.net",
        "gmx.de",
        "web.de",
      ];
      for (const domain of free) await sentTwice(trx, s, [`a@${domain}`]);
      await sentTwice(trx, s, ["a@kontrahent.pl"]);
      expect((await contextOf(trx, s)).sentDomains).toEqual(["kontrahent.pl"]);
    });
  });

  test("the reader reads only the newest maxMails mails", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await sentTo(trx, s, ["a@alt.pl"], { days: 50 });
      await sentTo(trx, s, ["a@alt.pl"], { days: 50 });
      await sentTo(trx, s, ["a@neu.pl"], { days: 2 });
      await sentTo(trx, s, ["a@neu.pl"], { days: 2 });
      const since = ago(90);
      expect(
        await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since, minMails: 1, limit: 10, maxMails: 2 })
      ).toEqual([{ domain: "neu.pl", mails: 2 }]);
      expect(await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since, minMails: 1, limit: 10 })).toHaveLength(2);
    });
  });

  test(
    "the default read is the newest 5000 mails: older mail beyond that count is not read",
    async () => {
      expect(SENT_RECIPIENT_MAX_MAILS).toBe(5000);
      await withRollback(db, async (trx) => {
        const s = await scene(trx);
        await sentTo(trx, s, ["a@alt.pl"], { days: 60 });
        await sentTo(trx, s, ["a@alt.pl"], { days: 60 });
        await seedSenderActivity(trx, s.ctx, s.mailboxId, {
          sent: Array.from({ length: SENT_RECIPIENT_MAX_MAILS }, () => ({ at: ago(2), to: ["a@neu.pl"] })),
        });
        const read = await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since: ago(90), minMails: 1, limit: 10 });
        expect(read).toEqual([{ domain: "neu.pl", mails: SENT_RECIPIENT_MAX_MAILS }]);
      });
    },
    MINUTE_MS
  );

  test("the 90 day window reads sent_at, not internal_date", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      // Written long ago (`sent_at`) and stored lately (`internal_date`): outside the window.
      await sentTo(trx, s, ["a@old.pl"], { days: 100 });
      await sentTo(trx, s, ["a@old.pl"], { days: 100 });
      await trx
        .updateTable("sent_emails")
        .set({ internal_date: ago(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      // Written lately (`sent_at`) and stored long ago (`internal_date`): inside the window.
      await sentTo(trx, s, ["a@new.pl"], { days: 3 });
      await sentTo(trx, s, ["a@new.pl"], { days: 3 });
      await trx
        .updateTable("sent_emails")
        .set({ internal_date: ago(100) })
        .where("mailbox_id", "=", s.mailboxId)
        .where("sent_at", ">", ago(10))
        .execute();
      expect(await sentRecipientDomains(trx, s.ctx, s.mailboxId, { since: ago(90), minMails: 1, limit: 10 })).toEqual([
        { domain: "new.pl", mails: 2 },
      ]);
    });
  });
});

// The statements of a plugin run: each raw statement keeps its text, so a test can tell the Sent read from the rest.
function recordingPlugin() {
  const statements: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      const node = args.node as unknown as { sqlFragments?: readonly string[] };
      statements.push(node.sqlFragments === undefined ? "" : node.sqlFragments.join("?"));
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { statements, plugin };
}

const sentReads = (statements: string[]): number => statements.filter((text) => text.includes("unnest(")).length;
const flaggedReads = (statements: string[]): number =>
  statements.filter((text) => text.includes("cardinality(latest.suspicious_reasons) > 0")).length;

describe("the cache of the Sent domains", () => {
  test("a second batch makes no domain read; a new Sent mail or 10 minutes end the entry", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTwice(trx, s, ["a@kontrahent.pl"]);
      const { statements, plugin } = recordingPlugin();
      const load = (at: Date) =>
        loadSuspiciousContext(trx.withPlugin(plugin), s.ctx, {
          mailbox: { id: s.mailboxId, rules: [], delegates: [] },
          imapHost: "imap.x.test",
          senders: [],
          trustedAuthservIds: [],
          now: at,
        });

      expect((await load(now)).sentDomains).toEqual(["kontrahent.pl"]);
      expect([sentReads(statements), flaggedReads(statements)]).toEqual([1, 1]);

      const before = statements.length;
      expect((await load(new Date(now.getTime() + 9 * MINUTE_MS))).sentDomains).toEqual(["kontrahent.pl"]);
      expect([sentReads(statements), flaggedReads(statements)]).toEqual([1, 1]);
      expect(statements.length - before).toBeGreaterThan(0);

      await sentTwice(trx, s, ["a@neuer.pl"]);
      expect((await load(now)).sentDomains).toEqual(["kontrahent.pl", "neuer.pl"]);
      expect(sentReads(statements)).toBe(2);

      await load(new Date(now.getTime() + 11 * MINUTE_MS));
      expect(sentReads(statements)).toBe(3);
    });
  });

  test("a swap of Sent mail with the same count still ends the entry", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      await sentTwice(trx, s, ["a@erste.pl"]);
      expect((await contextOf(trx, s)).sentDomains).toEqual(["erste.pl"]);
      await trx.deleteFrom("sent_emails").where("mailbox_id", "=", s.mailboxId).execute();
      await sentTwice(trx, s, ["a@zweite.pl"]);
      expect((await contextOf(trx, s)).sentDomains).toEqual(["zweite.pl"]);
    });
  });

  test("with a flag off nothing is read and nothing is cached", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, { suspicious: false });
      await sentTwice(trx, s, ["a@kontrahent.pl"]);
      const { statements, plugin } = recordingPlugin();
      const context = await loadSuspiciousContext(trx.withPlugin(plugin), s.ctx, {
        mailbox: { id: s.mailboxId, rules: [], delegates: [] },
        imapHost: "imap.x.test",
        senders: [],
        trustedAuthservIds: [],
        now,
      });
      expect(context.sentDomains).toEqual([]);
      expect(sentReads(statements)).toBe(0);
    });
  });

  test("the cache is per mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await scene(trx);
      const b = await scene(trx);
      await setFlags(trx, a, {});
      await setFlags(trx, b, {});
      await sentTwice(trx, a, ["a@kontrahent.pl"]);
      await sentTwice(trx, b, ["a@fremd.pl"]);
      expect((await contextOf(trx, a)).sentDomains).toEqual(["kontrahent.pl"]);
      expect((await contextOf(trx, b)).sentDomains).toEqual(["fremd.pl"]);
      expect((await contextOf(trx, a)).sentDomains).toEqual(["kontrahent.pl"]);
    });
  });
  test("a new Sent mail with the same sent_at and a lower id still ends the entry", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await setFlags(trx, s, {});
      const insert = (id: string, to: string) =>
        trx
          .insertInto("sent_emails")
          .values({
            id,
            org_id: s.ctx.orgId,
            mailbox_id: s.mailboxId,
            dedup_key: `mid:${randomUUID()}`,
            path: "Sent",
            uidvalidity: "7",
            uid: "1",
            message_id: `<${randomUUID()}@x.test>`,
            thread_key: `test:${randomUUID()}`,
            to_addresses: [to],
            cc_addresses: [],
            origin: "user",
            content: "headers_only",
            sent_at: ago(3),
            internal_date: ago(3),
          })
          .execute();
      await insert("ffffffff-0000-4000-8000-000000000001", "a@erste.pl");
      await insert("ffffffff-0000-4000-8000-000000000002", "a@erste.pl");
      expect((await contextOf(trx, s)).sentDomains).toEqual(["erste.pl"]);
      await insert("00000000-0000-4000-8000-000000000001", "a@zweite.pl");
      await insert("00000000-0000-4000-8000-000000000002", "a@zweite.pl");
      expect((await contextOf(trx, s)).sentDomains).toEqual(["erste.pl", "zweite.pl"]);
    });
  });
});

describe("suspiciousSenderDomains", () => {
  test("registrable domains of flagged senders; a tenant of a shared hosting suffix stays apart", async () => {
    await withRollback(db, async (trx) => {
      const s = await scene(trx);
      await incomingWith(trx, s, "x@mail.kontrahemt.pl", ["lookalike_domain"]);
      await incomingWith(trx, s, "x@alpha.herokuapp.com", ["auth_fail"]);
      await incomingWith(trx, s, "x@sauber.pl", []);
      const found = await suspiciousSenderDomains(trx, s.ctx, s.mailboxId, ago(90));
      expect([...found].sort()).toEqual(["alpha.herokuapp.com", "kontrahemt.pl"]);
    });
  });
});
