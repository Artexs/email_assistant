import { randomUUID } from "node:crypto";

import { isStorableSuggestionPattern, matchSender, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { listSenderRules } from "../../src/modules/config";
import { insertSenderRule } from "../../src/modules/config/repo";
import { acceptSuggestion, refreshMailboxProfiles } from "../../src/modules/contacts";
import type { DB } from "../../src/platform/db";
import { createDb } from "../../src/platform/db";
import { captureLogs } from "../log-capture";

import {
  ago,
  KEY,
  mails,
  NO_TEST,
  NOW,
  openOf,
  refresh,
  rescuedMails,
  rowsOf,
  secondMailbox,
  seed,
  spamMails,
  suggestOrg,
  summary,
  withSentCoverage,
  type Org,
} from "./contacts-fixtures";
import { insertDelegate, seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Repairs after the review of the suggestion step: a pattern that the table refuses, protections of a domain row by rules and
// delegates, the address rule of a rule made from a profile address, shared tenant domains, and a reply to a Reply-To address.
const db = testDb();
const orgIds: string[] = [];
const userIds: string[] = [];
afterEach(async () => {
  if (orgIds.length > 0) await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
  if (userIds.length > 0) await db.deleteFrom("users").where("id", "in", userIds).execute();
  orgIds.length = 0;
  userIds.length = 0;
});
afterAll(async () => {
  await db.destroy();
});

const later = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);
const pass = (org: Org, d: typeof db | Transaction<DB> = db) =>
  refreshMailboxProfiles({ db: d, credentialsKey: KEY, testMail: NO_TEST }, org.ctx, org.mailboxId, { now: NOW });
const profileCount = async (org: Org) =>
  (await db.selectFrom("sender_profiles").select("id").where("mailbox_id", "=", org.mailboxId).execute()).length;

// An organization with Sent coverage, committed (two connections or several passes read it).
async function committedOrg(build: (trx: Transaction<DB>, org: Org) => Promise<void>): Promise<Org> {
  const { org, userId } = await db.transaction().execute(async (trx) => {
    const created = await suggestOrg(trx);
    await withSentCoverage(trx, created);
    await build(trx, created);
    const owner = await trx
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", created.ctx.orgId)
      .executeTakeFirstOrThrow();
    return { org: created, userId: owner.user_id };
  });
  orgIds.push(org.ctx.orgId);
  userIds.push(userId);
  return org;
}

// The two spam mails of a sender; the first one has the given Message-ID.
const spamMailsWithId = (messageId: string) => spamMails().map((mail, i) => (i === 0 ? { ...mail, messageId } : mail));

const BAD_ADDRESSES: [string, string][] = [
  ["a local part of 250 characters", `${"a".repeat(250)}@acme.pl`],
  ["an angle bracket", "spam<x>@acme.pl"],
  ["a control character", "spam\u0001x@acme.pl"],
];

describe("a candidate that the table refuses never fails the pass", () => {
  for (const [label, address] of BAD_ADDRESSES) {
    test(`1 ${label}: the pass writes every profile, makes no row for it and still suggests the others`, async () => {
      await withRollback(db, async (trx) => {
        const org = await suggestOrg(trx);
        await withSentCoverage(trx, org);
        await seed(trx, org, "friend@other.pl", mails(3, 1));
        await seed(trx, org, address, spamMails());
        await seed(trx, org, "anna@acme.pl", mails(8, 6));
        // The validator drops the candidate before the INSERT: the safety net of the pass never runs, so no line is logged.
        const logs = captureLogs();
        try {
          const result = await refresh(trx, org);
          expect(result).toMatchObject({ written: 3, skipped: false });
        } finally {
          logs.stop();
        }
        expect(logs.lines.filter((line) => line.includes("contacts_suggestion_refused"))).toEqual([]);
        expect(summary(await openOf(trx, org))).toEqual(["open:vip:address:anna@acme.pl"]);
      });
    });
  }

  test("2 committed data, two passes in a row: no error, all profiles there (a refused row used to roll all of them back)", async () => {
    const org = await committedOrg(async (trx, created) => {
      await seed(trx, created, "friend@other.pl", mails(3, 1));
      await seed(trx, created, "spam<x>@acme.pl", spamMails());
    });
    expect(await pass(org)).toMatchObject({ written: 2, skipped: false });
    expect(await pass(org)).toMatchObject({ written: 0, unchanged: 2, skipped: false });
    expect(await profileCount(org)).toBe(2);
  });

  test("3 a text that the validator accepts must never be one that the table refuses (probe list against the real CHECK)", async () => {
    const probes = [
      "anna@acme.pl",
      "@acme.pl",
      "jürgen@acme.pl",
      "a+b@acme.pl",
      "ab",
      "a",
      "",
      "Anna@acme.pl",
      "a b@acme.pl",
      "a\tb@acme.pl",
      "a b@acme.pl",
      "a b@acme.pl",
      "a​b@acme.pl",
      "a\u0000b".replace("\u0000", "\u0001"),
      "a\u007fb@acme.pl",
      "a<b@acme.pl",
      "a>b@acme.pl",
      `${"a".repeat(246)}@acme.pl`,
      `${"a".repeat(247)}@acme.pl`,
      `${"😀".repeat(246)}@acme.pl`,
      "﻿a@acme.pl",
      "αννασ@acme.pl",
    ];
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      let accepted = 0;
      for (const [index, probe] of probes.entries()) {
        await sql`SAVEPOINT probe`.execute(trx);
        let tableAccepts = true;
        try {
          await trx
            .insertInto("sender_suggestions")
            .values({
              org_id: org.ctx.orgId,
              mailbox_id: org.mailboxId,
              key_hash: `${index}`.padStart(64, "0"),
              scope: probe.startsWith("@") ? "domain" : "address",
              kind: "vip",
              pattern: probe,
            })
            .execute();
        } catch (error) {
          if ((error as { code?: string }).code !== "23514") throw error;
          tableAccepts = false;
        }
        await sql`ROLLBACK TO SAVEPOINT probe`.execute(trx);
        if (isStorableSuggestionPattern(probe)) {
          accepted += 1;
          expect(tableAccepts).toBe(true);
        }
      }
      expect(accepted).toBeGreaterThanOrEqual(6);
    });
  });

  test("4 the safety net: a candidate that the table refuses anyway is skipped, the others get its slot, and the log holds a count only", async () => {
    // A trigger of the owner role raises the CHECK error for one address that the validator accepts.
    const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
    if (ownerUrl === undefined) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role makes the trigger");
    const owner = createDb(ownerUrl);
    const org = await committedOrg(async (trx, created) => {
      await seed(trx, created, "refused@acme.pl", rescuedMails());
      for (const name of ["a", "b", "c"]) await seed(trx, created, `${name}@acme${name}.pl`, mails(8, 6));
    });
    const fn = `refuse_pattern_${org.mailboxId.replaceAll("-", "")}`;
    const logs = captureLogs();
    try {
      await sql
        .raw(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
             IF NEW.pattern = 'refused@acme.pl' THEN
               RAISE EXCEPTION 'refused' USING ERRCODE = '23514';
             END IF;
             RETURN NEW;
           END $f$`
        )
        .execute(owner);
      await sql
        .raw(
          `CREATE TRIGGER ${fn} BEFORE INSERT ON sender_suggestions FOR EACH ROW
           WHEN (NEW.org_id = '${org.ctx.orgId}') EXECUTE FUNCTION ${fn}()`
        )
        .execute(owner);
      expect(await pass(org)).toMatchObject({ written: 4, skipped: false });
    } finally {
      logs.stop();
      await sql.raw(`DROP TRIGGER IF EXISTS ${fn} ON sender_suggestions`).execute(owner);
      await sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`).execute(owner);
      await owner.destroy();
    }
    const rows = await db
      .selectFrom("sender_suggestions")
      .select(["kind", "pattern"])
      .where("mailbox_id", "=", org.mailboxId)
      .execute();
    // The refused whitelist came first in the order; its slot went to the three VIP rows.
    expect(rows.map((row) => `${row.kind}:${row.pattern}`).sort()).toEqual([
      "vip:a@acmea.pl",
      "vip:b@acmeb.pl",
      "vip:c@acmec.pl",
    ]);
    const refusedLines = logs.lines.filter((line) => line.includes("contacts_suggestion_refused"));
    expect(refusedLines).toHaveLength(1);
    expect(refusedLines[0]).toContain('"count":1');
    expect(logs.lines.join("\n")).not.toContain("@");
  });
});

describe("a domain suggestion respects the rules and the delegates of the user (D10)", () => {
  const RESCUED = ["a@acme.pl", "b@acme.pl"];
  const SPAMMERS = ["x@acme.pl", "y@acme.pl"];

  test("5 a domain whitelist is not made while an address of the domain has a block rule; the address rows stay", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "spammer@acme.pl", kind: "blocklist" });
      for (const address of RESCUED) await seed(trx, org, address, rescuedMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual([
        "open:whitelist:address:a@acme.pl",
        "open:whitelist:address:b@acme.pl",
      ]);
    });
  });

  test("5b a block rule of a subdomain, or of the whole organization, protects the domain too; a rule of another mailbox does not", async () => {
    await withRollback(db, async (trx) => {
      const subdomain = await suggestOrg(trx);
      const wide = await suggestOrg(trx);
      const elsewhere = await suggestOrg(trx);
      const otherBox = await secondMailbox(trx, elsewhere);
      await insertSenderRule(trx, subdomain.ctx, { mailboxId: null, pattern: "news.acme.pl", kind: "blocklist" });
      await insertSenderRule(trx, wide.ctx, { mailboxId: null, pattern: "spammer@acme.pl", kind: "blocklist" });
      await insertSenderRule(trx, elsewhere.ctx, {
        mailboxId: otherBox.mailboxId,
        pattern: "spammer@acme.pl",
        kind: "blocklist",
      });
      for (const target of [subdomain, wide, elsewhere]) {
        for (const address of RESCUED) await seed(trx, target, address, rescuedMails());
        await refresh(trx, target);
      }
      for (const target of [subdomain, wide]) {
        expect(summary(await openOf(trx, target))).toEqual([
          "open:whitelist:address:a@acme.pl",
          "open:whitelist:address:b@acme.pl",
        ]);
      }
      expect(summary(await openOf(trx, elsewhere))).toEqual(["open:whitelist:domain:@acme.pl"]);
    });
  });

  test("5c an open domain whitelist row ends when the user adds a block rule for an address of the domain", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      for (const address of RESCUED) await seed(trx, org, address, rescuedMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:whitelist:domain:@acme.pl"]);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "spammer@acme.pl", kind: "blocklist" });
      await refresh(trx, org, later(1));
      expect(summary(await rowsOf(trx, org))).toEqual([
        "open:whitelist:address:a@acme.pl",
        "open:whitelist:address:b@acme.pl",
        "withdrawn:whitelist:domain:null",
      ]);
    });
  });

  test("6 a domain blocklist is not made while an active delegate has an address on the domain, though the delegate sent nothing", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await insertDelegate(trx, org.ctx, { email: "ola@acme.pl" });
      for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual([
        "open:blocklist:address:x@acme.pl",
        "open:blocklist:address:y@acme.pl",
      ]);
    });
  });

  test("6b an inactive delegate does not protect the domain", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await insertDelegate(trx, org.ctx, { email: "ola@acme.pl", active: false });
      for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:blocklist:domain:@acme.pl"]);
    });
  });

  test("6c an open domain blocklist row ends when a delegate of the domain is added", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:blocklist:domain:@acme.pl"]);
      await insertDelegate(trx, org.ctx, { email: "ola@acme.pl" });
      await refresh(trx, org, later(1));
      expect(summary(await rowsOf(trx, org))).toEqual([
        "open:blocklist:address:x@acme.pl",
        "open:blocklist:address:y@acme.pl",
        "withdrawn:blocklist:domain:null",
      ]);
    });
  });

  test("6d a VIP rule or a whitelist rule of an address of the domain protects it from a domain blocklist", async () => {
    for (const kind of ["vip", "whitelist"] as const) {
      await withRollback(db, async (trx) => {
        const org = await suggestOrg(trx);
        await withSentCoverage(trx, org);
        await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "boss@acme.pl", kind });
        for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
        await refresh(trx, org);
        expect(summary(await openOf(trx, org))).toEqual([
          "open:blocklist:address:x@acme.pl",
          "open:blocklist:address:y@acme.pl",
        ]);
      });
    }
  });
});

describe("a rule that an accepted suggestion makes matches the real sender", () => {
  for (const [stored, real] of [
    ["αννας@acme.pl", "αννας@acme.pl"],
    ["αννας@acme.pl", "ΑΝΝΑΣ@ACME.PL"],
    ["İlker@acme.pl", "İlker@acme.pl"],
    ["İLKER@acme.pl", "ilker@acme.pl"],
  ] as const) {
    test(`7 ${stored} suggested, accepted, then the sender ${real} is a VIP`, async () => {
      await withRollback(db, async (trx) => {
        const org = await suggestOrg(trx);
        await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: stored, mails: mails(8, 6) });
        await refresh(trx, org);
        const [row] = await openOf(trx, org);
        expect(row).toBeDefined();
        const result = await acceptSuggestion({ db: trx, now: () => NOW, testMail: NO_TEST }, org.ctx, {
          id: row?.id ?? "",
          actor: "cli",
          via: "cli",
        });
        expect(result).toBe("accepted");
        const rules = await listSenderRules(trx, org.ctx, org.mailboxId);
        expect(matchSender(real, rules).vip).toBe(true);
      });
    });
  }

  test("7b a rule that the user types with the final sigma ends the open row of the folded address", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { address: "αννας@acme.pl", mails: mails(8, 6) });
      await refresh(trx, org);
      expect(await openOf(trx, org)).toHaveLength(1);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "αννας@acme.pl", kind: "vip" });
      await refresh(trx, org, later(1));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:vip:address:null"]);
    });
  });
});

describe("shared tenant domains and replies to a Reply-To address", () => {
  test("8 two spam senders on two tenants of onmicrosoft.com get address rows, never a domain blocklist", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await seed(trx, org, "x@evil1.onmicrosoft.com", spamMails());
      await seed(trx, org, "y@evil2.onmicrosoft.com", spamMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual([
        "open:blocklist:address:x@evil1.onmicrosoft.com",
        "open:blocklist:address:y@evil2.onmicrosoft.com",
      ]);
    });
  });

  test("9 a sender whose mail the user answered with a Sent mail to a Reply-To address gets no blocklist row", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      const messageId = `<${randomUUID()}@vendor.pl>`;
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "sales@vendor.pl",
        mails: spamMailsWithId(messageId),
        sent: [{ at: ago(0, 12), parent: messageId, to: ["replies@vendor-crm.pl"] }],
      });
      await refresh(trx, org);
      expect(await openOf(trx, org)).toEqual([]);
    });
  });

  test("9c a Sent reply of another mailbox, of another organization, or dated before the mail does not protect the sender", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      const stranger = await suggestOrg(trx);
      const otherBox = await secondMailbox(trx, org);
      const messageId = `<${randomUUID()}@vendor.pl>`;
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "sales@vendor.pl",
        mails: spamMailsWithId(messageId),
        // Sent 5 days before the mail of day 1 arrived: not a reply to it.
        sent: [{ at: ago(6), parent: messageId, to: ["replies@vendor-crm.pl"] }],
      });
      const reply = { at: ago(0, 12), parent: messageId, to: ["replies@vendor-crm.pl"] };
      await seedSenderActivity(trx, org.ctx, otherBox.mailboxId, { sent: [reply] });
      await seedSenderActivity(trx, stranger.ctx, stranger.mailboxId, { sent: [reply] });
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:blocklist:address:sales@vendor.pl"]);
    });
  });

  test("9b an open blocklist row ends when the user replies to such a mail; a system send or an automatic reply does not count", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      const messageId = `<${randomUUID()}@vendor.pl>`;
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        address: "sales@vendor.pl",
        mails: spamMailsWithId(messageId),
        sent: [
          { at: ago(0, 12), parent: messageId, to: ["replies@vendor-crm.pl"], system: true },
          { at: ago(0, 11), parent: messageId, to: ["replies@vendor-crm.pl"], autoSubmitted: "auto-replied" },
        ],
      });
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:blocklist:address:sales@vendor.pl"]);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, {
        sent: [{ at: ago(0, 10), parent: messageId, to: ["replies@vendor-crm.pl"] }],
      });
      await refresh(trx, org, later(1));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:blocklist:address:null"]);
    });
  });
});
