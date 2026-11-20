import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOUR_MS, DAY_MS } from "@ea/core";
import type { DkimSignature } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertMailbox } from "../../src/modules/mail/repo";
import { hasHttpsUnsubscribeLink, listNewsletterSenders, NEWSLETTER_MAX_SENDERS } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The per-sender newsletter reader (tests 6 and 7 of the stage file, and the rules around them).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-15T12:00:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const TRUSTED = { trustedAuthservIds: ["interia.pl"] };
const LINK = "<https://u.c.example/unsub?id=1>, <mailto:unsub@c.example>";
const ONE_CLICK = true;

interface Mail {
  from: string;
  category?: "info" | "notification" | "spam" | "urgent" | "needs_reply" | "unsure";
  at?: Date;
  reasons?: string[];
  fromName?: string | null;
  authResults?: string | null;
  link?: string | null;
  post?: boolean | null;
  /** The stored `dkim_signatures`; default: one signature of `c.example` that covers both list headers when `post` is true. */
  signatures?: DkimSignature[] | null;
}

const FULL = ["from", "to", "subject", "list-unsubscribe", "list-unsubscribe-post"];
const COVERING: DkimSignature[] = [{ d: "c.example", h: FULL }];
// SQL NULL for a row from before the column, else the JSON array.
const signaturesJson = (value: DkimSignature[] | null): string | null =>
  value === null ? null : JSON.stringify(value);

// A triaged mail with its header row. `post: null` stores the NULL of a row from before the column.
async function mail(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, m: Mail): Promise<string> {
  const id = await insertTriaged(trx, ctx, mailboxId, {
    category: m.category ?? "notification",
    createdAt: m.at ?? ago(HOUR_MS),
    from: m.from,
    suspiciousReasons: m.reasons ?? [],
  });
  await trx
    .insertInto("email_headers")
    .values({
      email_id: id,
      org_id: ctx.orgId,
      from_name: m.fromName ?? null,
      auth_results: m.authResults ?? null,
      list_unsubscribe: m.link ?? null,
      list_unsubscribe_post: m.post ?? null,
      dkim_signatures: signaturesJson(m.signatures === undefined ? (m.post === true ? COVERING : null) : m.signatures),
      parts_known: true,
      captured_at: m.at ?? ago(HOUR_MS),
    })
    .execute();
  return id;
}

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  return { a, ctx: { orgId: a.orgId } };
}

const PASS = "interia.pl; dkim=pass header.d=c.example";

describe("listNewsletterSenders", () => {
  test("6: suspicious and spam senders are left out; C is one-click, D (dkim=fail) is a link only", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const c = { link: LINK, post: ONE_CLICK };
      // A: one suspicious mail and one clean mail. S: one spam mail among clean ones.
      await mail(trx, ctx, a.mailboxId, {
        from: "a@c.example",
        reasons: ["lookalike_domain"],
        ...c,
        authResults: PASS,
      });
      await mail(trx, ctx, a.mailboxId, { from: "a@c.example", ...c, authResults: PASS });
      await mail(trx, ctx, a.mailboxId, { from: "s@c.example", category: "spam", ...c, authResults: PASS });
      await mail(trx, ctx, a.mailboxId, { from: "s@c.example", ...c, authResults: PASS });
      await mail(trx, ctx, a.mailboxId, { from: "news@c.example", fromName: "C News", ...c, authResults: PASS });
      await mail(trx, ctx, a.mailboxId, {
        from: "d@c.example",
        ...c,
        authResults: "interia.pl; dkim=fail header.d=c.example",
      });

      const senders = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      expect(senders.map((s) => s.senderLower).sort()).toEqual(["d@c.example", "news@c.example"]);
      const bySender = new Map(senders.map((s) => [s.senderLower, s]));
      expect(bySender.get("news@c.example")).toMatchObject({
        fromName: "C News",
        count: 1,
        oneClick: true,
        hasLink: true,
      });
      expect(bySender.get("d@c.example")).toMatchObject({ oneClick: false, hasLink: true });
    });
  });

  test("6b: one-click needs a signature of the passing domain that covers both list headers", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const m = (from: string, signatures: DkimSignature[] | null) =>
        mail(trx, ctx, a.mailboxId, { from, link: LINK, post: ONE_CLICK, authResults: PASS, signatures });
      await m("covered@c.example", COVERING);
      await m("nopost@c.example", [{ d: "c.example", h: ["from", "list-unsubscribe"] }]);
      await m("nolink@c.example", [{ d: "c.example", h: ["from", "list-unsubscribe-post"] }]);
      await m("bodyonly@c.example", [{ d: "c.example", h: ["from"] }]);
      await m("other@c.example", [{ d: "esp.example", h: FULL }]);
      await m("old@c.example", null);
      await m("empty@c.example", []);
      // A second signature of the same domain that does not cover: the verified one may be that one.
      await m("two@c.example", [...COVERING, { d: "c.example", h: ["from"] }]);
      await m("twook@c.example", [...COVERING, { d: "c.example", h: [...FULL, "date"] }]);
      const flags = Object.fromEntries(
        (await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED)).map((s) => [
          s.senderLower.split("@")[0],
          [s.oneClick, s.hasLink],
        ])
      );
      expect(flags).toEqual({
        covered: [true, true],
        nopost: [false, true],
        nolink: [false, true],
        bodyonly: [false, true],
        other: [false, true],
        old: [false, true],
        empty: [false, true],
        two: [false, true],
        twook: [true, true],
      });
    });
  });

  test("6c: a stored value of another shape is no proof", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const id = await mail(trx, ctx, a.mailboxId, {
        from: "x@c.example",
        link: LINK,
        post: ONE_CLICK,
        authResults: PASS,
      });
      await sql`UPDATE email_headers SET dkim_signatures = '[{"d":"c.example"}]'::jsonb WHERE email_id = ${id}`.execute(
        trx
      );
      expect((await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED))[0]).toMatchObject({
        oneClick: false,
        hasLink: true,
      });
    });
  });

  test("7: dkim=pass in a header of an authserv-id that is not trusted does not give one-click", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const c = { from: "news@c.example", link: LINK, post: ONE_CLICK };
      await mail(trx, ctx, a.mailboxId, { ...c, authResults: "evil.example; dkim=pass header.d=c.example" });
      const [sender] = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      expect(sender).toMatchObject({ oneClick: false, hasLink: true });
      // With no trusted id configured, no sender is one-click.
      expect((await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, { trustedAuthservIds: [] }))[0]?.oneClick).toBe(
        false
      );
    });
  });

  test("7b: one-click needs every part: the post header, an https link, and dkim for the From domain", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const m = (from: string, extra: Partial<Mail>) =>
        mail(trx, ctx, a.mailboxId, { from, link: LINK, post: ONE_CLICK, authResults: PASS, ...extra });
      await m("ok@c.example", {});
      await m("nopost@c.example", { post: false });
      await m("oldrow@c.example", { post: null });
      await m("http@c.example", { link: "<http://u.c.example/x>" });
      await m("mailto@c.example", { link: "<mailto:u@c.example>" });
      await m("nolink@c.example", { link: null });
      await m("other@c.example", { authResults: "interia.pl; dkim=pass header.d=other.example" });
      await m("noauth@c.example", { authResults: null });

      const senders = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      const flags = Object.fromEntries(senders.map((s) => [s.senderLower.split("@")[0], [s.oneClick, s.hasLink]]));
      expect(flags).toEqual({
        ok: [true, true],
        nopost: [false, true],
        oldrow: [false, true],
        http: [false, false],
        mailto: [false, false],
        nolink: [false, false],
        other: [false, true],
        noauth: [false, true],
      });
    });
  });

  test("8: a sender with a mail of another category is left out; mail with no result and old mail do not count", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const c = { link: LINK, post: ONE_CLICK };
      await mail(trx, ctx, a.mailboxId, { from: "mixed@c.example", category: "info", ...c });
      await mail(trx, ctx, a.mailboxId, { from: "mixed@c.example", category: "needs_reply" });
      await mail(trx, ctx, a.mailboxId, { from: "unsure@c.example", category: "unsure" });
      // A spam mail older than 30 days does not block the sender; a mail with no result does not count.
      await mail(trx, ctx, a.mailboxId, { from: "later@c.example", category: "spam", at: ago(31 * DAY_MS) });
      await mail(trx, ctx, a.mailboxId, { from: "later@c.example", category: "info", at: ago(2 * DAY_MS), ...c });
      await insertTestEmail(trx, ctx, a.mailboxId, { from_address: "later@c.example", received_at: ago(HOUR_MS) });
      // Only an old mail: no sender in the window.
      await mail(trx, ctx, a.mailboxId, { from: "gone@c.example", at: ago(31 * DAY_MS) });

      const senders = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      expect(senders.map((s) => [s.senderLower, s.count])).toEqual([["later@c.example", 1]]);
    });
  });

  test("9: the newest mail decides the flags, the count orders the list, the newest mail ids come back", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const c = { link: LINK, post: ONE_CLICK, authResults: PASS };
      // Older mails are one-click, the newest has no post header: not one-click.
      await mail(trx, ctx, a.mailboxId, { from: "news@c.example", at: ago(5 * DAY_MS), fromName: "Old name", ...c });
      const newest = await mail(trx, ctx, a.mailboxId, {
        from: "news@c.example",
        at: ago(DAY_MS),
        fromName: "New name",
        ...c,
        post: false,
      });
      await mail(trx, ctx, a.mailboxId, { from: "busy@c.example", category: "info", at: ago(3 * DAY_MS) });
      await mail(trx, ctx, a.mailboxId, { from: "busy@c.example", category: "info", at: ago(2 * DAY_MS) });
      await mail(trx, ctx, a.mailboxId, { from: "busy@c.example", category: "info", at: ago(10 * DAY_MS) });
      // Retention cleared the header texts: no link, no auth results, the flag stays.
      await mail(trx, ctx, a.mailboxId, { from: "cleared@c.example", post: true, link: null, authResults: null });

      const senders = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      expect(senders.map((s) => [s.senderLower, s.count])).toEqual([
        ["busy@c.example", 3],
        ["news@c.example", 2],
        ["cleared@c.example", 1],
      ]);
      expect(senders[1]).toMatchObject({
        fromName: "New name",
        latestEmailId: newest,
        latestAt: ago(DAY_MS),
        oneClick: false,
        hasLink: true,
      });
      expect(senders[2]).toMatchObject({ oneClick: false, hasLink: false });
    });
  });

  test("10: another organization and another mailbox never show; at most 200 senders", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const b = await createOrgWithMailbox(trx);
      const secondId = randomUUID();
      await insertMailbox(trx, ctx, {
        id: secondId,
        address: `second-${secondId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await mail(trx, { orgId: b.orgId }, b.mailboxId, { from: "other-org@c.example" });
      await mail(trx, ctx, secondId, { from: "other-box@c.example" });
      await mail(trx, ctx, a.mailboxId, { from: "mine@c.example" });
      expect((await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED)).map((s) => s.senderLower)).toEqual([
        "mine@c.example",
      ]);

      // The mailbox of this organization read in the scope of another organization shows nothing.
      expect(await listNewsletterSenders(trx, { orgId: b.orgId }, a.mailboxId, NOW, TRUSTED)).toEqual([]);

      for (let n = 0; n < NEWSLETTER_MAX_SENDERS + 5; n += 1)
        await mail(trx, ctx, a.mailboxId, { from: `bulk${String(n).padStart(3, "0")}@c.example` });
      const many = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      expect(many).toHaveLength(NEWSLETTER_MAX_SENDERS);
      expect(many.map((s) => s.senderLower)).not.toContain("other-org@c.example");
    });
  });
});

describe("the 30-day edge", () => {
  test("13: a mail received exactly 30 days before now counts; one millisecond older does not", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx } = await setup(trx);
      const c = { link: LINK, post: ONE_CLICK };
      await mail(trx, ctx, a.mailboxId, { from: "edge@c.example", at: ago(30 * DAY_MS), ...c });
      await mail(trx, ctx, a.mailboxId, { from: "outside@c.example", at: ago(30 * DAY_MS + 1), ...c });
      // A spam mail one millisecond outside the window does not block its sender; one exactly on the edge does.
      await mail(trx, ctx, a.mailboxId, { from: "old-spam@c.example", at: ago(30 * DAY_MS + 1), category: "spam" });
      await mail(trx, ctx, a.mailboxId, { from: "old-spam@c.example", at: ago(DAY_MS), ...c });
      await mail(trx, ctx, a.mailboxId, { from: "edge-spam@c.example", at: ago(30 * DAY_MS), category: "spam" });
      await mail(trx, ctx, a.mailboxId, { from: "edge-spam@c.example", at: ago(DAY_MS), ...c });

      const senders = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
      expect(senders.map((s) => [s.senderLower, s.count]).sort()).toEqual([
        ["edge@c.example", 1],
        ["old-spam@c.example", 1],
      ]);
    });
  });
});

describe("a link in a mail is data, never an action", () => {
  test("12: reading the senders makes no request: fetch is never called, and the module imports no HTTP client", async () => {
    const real = globalThis.fetch;
    const calls: unknown[] = [];
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      throw new Error("a request was made");
    }) as unknown as typeof fetch;
    try {
      await withRollback(db, async (trx) => {
        const { a, ctx } = await setup(trx);
        await mail(trx, ctx, a.mailboxId, { from: "news@c.example", link: LINK, post: ONE_CLICK, authResults: PASS });
        const senders = await listNewsletterSenders(trx, ctx, a.mailboxId, NOW, TRUSTED);
        expect(senders).toHaveLength(1);
      });
    } finally {
      globalThis.fetch = real;
    }
    expect(calls).toEqual([]);
    const source = readFileSync(join(import.meta.dir, "../../src/modules/triage/newsletter-senders.ts"), "utf8");
    expect(source).not.toMatch(
      /\bfetch\s*\(|node:https?|node:net|node:dns|from "undici"|XMLHttpRequest|\bBun\.connect/
    );
  });
});

describe("hasHttpsUnsubscribeLink", () => {
  test("11: an https URI with a host among the angle-bracket items; nothing else", () => {
    expect(hasHttpsUnsubscribeLink("<https://u.test/x>")).toBe(true);
    expect(hasHttpsUnsubscribeLink("<mailto:u@u.test>, <HTTPS://u.test/x>")).toBe(true);
    expect(hasHttpsUnsubscribeLink("<http://u.test/x>")).toBe(false);
    expect(hasHttpsUnsubscribeLink("<mailto:u@u.test>")).toBe(false);
    expect(hasHttpsUnsubscribeLink("<https://>")).toBe(false);
    expect(hasHttpsUnsubscribeLink("https://u.test/x")).toBe(false);
    expect(hasHttpsUnsubscribeLink("<javascript:alert(1)>")).toBe(false);
    expect(hasHttpsUnsubscribeLink("")).toBe(false);
    expect(hasHttpsUnsubscribeLink(null)).toBe(false);
  });
});
