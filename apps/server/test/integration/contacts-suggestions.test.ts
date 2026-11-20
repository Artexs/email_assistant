import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { insertSenderRule } from "../../src/modules/config/repo";
import { setOrgFeature } from "../../src/modules/tenancy";

import {
  ago,
  DAY,
  hashOf,
  insertSuggestion,
  mails,
  newOrg,
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
} from "./contacts-fixtures";
import { seedSenderActivity } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The suggestion step of the profile pass. The clock is fixed (`NOW`) and the key is a test key. Every test runs in a
// transaction that rolls back; the other mailboxes of the database do not matter, because every query names its mailbox.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

describe("the suggestion step: VIP and the life of a row", () => {
  test("1 a sender with 6 of 8 answered in 30 days gives one open VIP row with the counts as reason", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await refresh(trx, org);
      const rows = await rowsOf(trx, org);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "vip",
        scope: "address",
        status: "open",
        pattern: "anna@acme.pl",
        key_hash: hashOf(org.ctx.orgId, "anna@acme.pl"),
        reason: { received: 8, answered: 6 },
      });
      expect(rows[0]?.created_at.getTime()).toBe(NOW.getTime());
    });
  });

  test("2 a second pass with the same data keeps one row", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await refresh(trx, org);
      await refresh(trx, org);
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["open:vip:address:anna@acme.pl"]);
    });
  });

  test("3 a VIP rule that the user adds by hand ends the open row as withdrawn, with no pattern", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await refresh(trx, org);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "anna@acme.pl", kind: "vip" });
      const later = new Date(NOW.getTime() + HOUR_MS);
      await refresh(trx, org, later);
      const rows = await rowsOf(trx, org);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "withdrawn", pattern: null, ended_by: null });
      expect(rows[0]?.ended_at?.getTime()).toBe(later.getTime());
    });
  });

  test("3b a rule of the whole organization, or a domain rule, covers the pattern too; a rule of another kind does not", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await seed(trx, org, "bob@corp.pl", mails(8, 6));
      await seed(trx, org, "cy@third.pl", mails(8, 6));
      await refresh(trx, org);
      expect(await openOf(trx, org)).toHaveLength(3);
      await insertSenderRule(trx, org.ctx, { mailboxId: null, pattern: "anna@acme.pl", kind: "vip" });
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "corp.pl", kind: "vip" });
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "third.pl", kind: "whitelist" });
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      // A whitelist rule does not cover a VIP suggestion: only the VIP rules do.
      expect(summary(await rowsOf(trx, org))).toEqual([
        "open:vip:address:cy@third.pl",
        "withdrawn:vip:address:null",
        "withdrawn:vip:address:null",
      ]);
    });
  });

  test("3c a rule of another mailbox does not cover the row of this mailbox", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const other = await secondMailbox(trx, org);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await refresh(trx, org);
      await insertSenderRule(trx, org.ctx, { mailboxId: other.mailboxId, pattern: "anna@acme.pl", kind: "vip" });
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["open:vip:address:anna@acme.pl"]);
    });
  });

  test("4 five qualifying senders and an empty week give 3 rows; the same week gives none more; 8 days later the rest", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      for (const name of ["a", "b", "c", "d", "e"]) await seed(trx, org, `${name}@acme${name}.pl`, mails(8, 6));
      await refresh(trx, org);
      expect(await openOf(trx, org)).toHaveLength(3);
      await refresh(trx, org, new Date(NOW.getTime() + 2 * DAY));
      expect(await openOf(trx, org)).toHaveLength(3);
      await refresh(trx, org, new Date(NOW.getTime() + 8 * DAY));
      const rows = await rowsOf(trx, org);
      expect(rows).toHaveLength(5);
      expect(rows.filter((row) => row.status === "open")).toHaveLength(5);
    });
  });

  test("4b the weekly cap counts a row that has ended, and each mailbox has its own cap", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const other = await secondMailbox(trx, org);
      for (const name of ["a", "b", "c", "d"]) await seed(trx, org, `${name}@acme${name}.pl`, mails(8, 6));
      for (const name of ["a", "b", "c", "d"]) {
        await seedSenderActivity(trx, org.ctx, other.mailboxId, {
          address: `${name}@acme${name}.pl`,
          mails: mails(8, 6),
        });
      }
      await refresh(trx, org);
      // Three rows are created and one is dismissed at once: the week still holds 3, so no fourth row is made.
      const first = await openOf(trx, org);
      expect(first).toHaveLength(3);
      await trx
        .updateTable("sender_suggestions")
        .set({ status: "dismissed", pattern: null, ended_at: NOW })
        .where("id", "=", first[0]?.id ?? "")
        .execute();
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(await openOf(trx, org)).toHaveLength(2);
      // The other mailbox had no row yet, so it gets its own three.
      await refresh(trx, { ...org, mailboxId: other.mailboxId });
      expect(await openOf(trx, org, other.mailboxId)).toHaveLength(3);
    });
  });

  test("5 a key dismissed 10 days ago is not suggested again; one dismissed 91 days ago is", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await seed(trx, org, "bob@corp.pl", mails(8, 6));
      await insertSuggestion(trx, org, {
        value: "anna@acme.pl",
        kind: "vip",
        status: "dismissed",
        createdAt: ago(40),
        endedAt: ago(10),
      });
      await insertSuggestion(trx, org, {
        value: "bob@corp.pl",
        kind: "vip",
        status: "dismissed",
        createdAt: ago(120),
        endedAt: ago(91),
      });
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:vip:address:bob@corp.pl"]);
    });
  });

  test("5b a dismissed kind hides only that kind and only in that mailbox", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const other = await secondMailbox(trx, org);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await insertSuggestion(trx, org, {
        value: "anna@acme.pl",
        kind: "whitelist",
        status: "dismissed",
        createdAt: ago(40),
        endedAt: ago(10),
      });
      await insertSuggestion(trx, org, {
        value: "anna@acme.pl",
        kind: "vip",
        status: "dismissed",
        createdAt: ago(40),
        endedAt: ago(10),
        mailboxId: other.mailboxId,
      });
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:vip:address:anna@acme.pl"]);
    });
  });

  test("6 with the flag sender_suggestions off the profiles are written and no suggestion row exists", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      const result = await refresh(trx, org);
      expect(result.written).toBe(1);
      expect(await rowsOf(trx, org)).toEqual([]);
    });
  });

  test("6b sender_suggestions on and sender_context off: nothing is read or written", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx, { flag: false });
      await setOrgFeature(trx, org.ctx, { flag: "sender_suggestions", enabled: true, actor: "cli", now: NOW });
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      expect((await refresh(trx, org)).skipped).toBe(true);
      expect(await rowsOf(trx, org)).toEqual([]);
    });
  });

  test("7 an open row created 31 days ago ends as expired with no pattern; one created 29 days ago stays open", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await insertSuggestion(trx, org, { value: "old@acme.pl", kind: "vip", createdAt: ago(31) });
      await insertSuggestion(trx, org, { value: "young@acme.pl", kind: "vip", createdAt: ago(29) });
      await refresh(trx, org);
      const rows = await rowsOf(trx, org);
      expect(summary(rows)).toEqual(["expired:vip:address:null", "open:vip:address:young@acme.pl"]);
      expect(rows.find((row) => row.status === "expired")?.ended_at?.getTime()).toBe(NOW.getTime());
    });
  });

  test("8 a ratio that falls to 50% leaves the VIP row open; a sender that turns bulk ends it as withdrawn", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      const first = await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await refresh(trx, org);
      expect(await openOf(trx, org)).toHaveLength(1);

      // Four more unanswered mails: 6 of 12 is 50%, below the rule. The row stays.
      await seed(
        trx,
        org,
        "anna@acme.pl",
        [1, 2, 3, 4].map((day) => ({ at: ago(day, 1), answered: false }))
      );
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["open:vip:address:anna@acme.pl"]);

      // List headers on most of the mail make the sender bulk.
      for (const id of first.emailIds) {
        await trx
          .insertInto("email_headers")
          .values({
            email_id: id,
            org_id: org.ctx.orgId,
            list_id: "<list.acme.pl>",
            parts_known: true,
            captured_at: ago(1),
          })
          .execute();
      }
      await refresh(trx, org, new Date(NOW.getTime() + 2 * HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:vip:address:null"]);
    });
  });
});

describe("the suggestion step: never conditions", () => {
  test("9 a suspicious mail blocks VIP and whitelist, and ends an open VIP row", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await refresh(trx, org);
      expect(await openOf(trx, org)).toHaveLength(1);
      await seed(trx, org, "anna@acme.pl", [{ at: ago(1, 1), category: "info", suspicious: true }]);
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:vip:address:null"]);

      await seed(trx, org, "carl@corp.pl", [...rescuedMails(), { at: ago(3), category: "info", suspicious: true }]);
      await refresh(trx, org, new Date(NOW.getTime() + 2 * HOUR_MS));
      expect(summary(await openOf(trx, org))).toEqual([]);
    });
  });

  test("10 a whitelist suggestion for a sender who was moved back from spam twice; none with a block rule; ended by a block rule", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "carl@corp.pl", rescuedMails());
      await seed(trx, org, "dora@corp2.pl", rescuedMails());
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "dora@corp2.pl", kind: "blocklist" });
      await refresh(trx, org);
      const rows = await openOf(trx, org);
      expect(summary(rows)).toEqual(["open:whitelist:address:carl@corp.pl"]);
      expect(rows[0]?.reason).toEqual({ rescued: 2 });
      // The block rule for carl ends his open whitelist row.
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "corp.pl", kind: "blocklist" });
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:whitelist:address:null"]);
    });
  });

  test("11 whitelist and blocklist both true for one address give neither", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      // Two mails moved back from spam and two corrected to spam: the signals disagree.
      await seed(trx, org, "mixed@acme.pl", [
        ...rescuedMails(),
        ...spamMails().map((mail) => ({ ...mail, at: ago(5) })),
      ]);
      await refresh(trx, org);
      expect(await rowsOf(trx, org)).toEqual([]);
    });
  });

  test("11b an open whitelist row ends when the block signal turns true too", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await seed(trx, org, "mixed@acme.pl", rescuedMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:whitelist:address:mixed@acme.pl"]);
      await seed(
        trx,
        org,
        "mixed@acme.pl",
        spamMails().map((mail) => ({ ...mail, at: ago(5) }))
      );
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:whitelist:address:null"]);
    });
  });
});

describe("the suggestion step: blocklist and Sent coverage", () => {
  test("12 with Sent coverage a sender corrected to spam twice, never answered, never written to, gets a blocklist row", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await seed(trx, org, "spam@bad.pl", spamMails());
      await refresh(trx, org);
      const rows = await openOf(trx, org);
      expect(summary(rows)).toEqual(["open:blocklist:address:spam@bad.pl"]);
      expect(rows[0]?.reason).toEqual({ corrected: 2 });
    });
  });

  test("12b a sender that the user wrote to is never a block candidate, and ends an open block row", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await seed(trx, org, "spam@bad.pl", spamMails());
      await refresh(trx, org);
      expect(await openOf(trx, org)).toHaveLength(1);
      await seedSenderActivity(trx, org.ctx, org.mailboxId, { sent: [{ at: ago(3), to: ["spam@bad.pl"] }] });
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:blocklist:address:null"]);
    });
  });

  test("13 without Sent coverage (the flag sent_sync off) no blocklist row is made and an open one is withdrawn", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "spam@bad.pl", spamMails());
      await refresh(trx, org);
      expect(await rowsOf(trx, org)).toEqual([]);
      await insertSuggestion(trx, org, { value: "spam@bad.pl", kind: "blocklist", createdAt: ago(8) });
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:blocklist:address:null"]);
    });
  });

  test("13b an open blocklist row ends with no activity of the sender in the window: coverage alone decides", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await insertSuggestion(trx, org, { value: "gone@bad.pl", kind: "blocklist", createdAt: ago(8) });
      await refresh(trx, org);
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:blocklist:address:null"]);
    });
  });

  test("14 a Sent pass that ended `folder_missing` gives no coverage, though it is fresh", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org, NOW, "folder_missing");
      await seed(trx, org, "spam@bad.pl", spamMails());
      await insertSuggestion(trx, org, { value: "old@bad.pl", kind: "blocklist", createdAt: ago(8) });
      await refresh(trx, org);
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:blocklist:address:null"]);
    });
  });

  test("14b a last Sent pass older than a day gives no coverage; one at 23 hours does", async () => {
    await withRollback(db, async (trx) => {
      const stale = await suggestOrg(trx);
      await withSentCoverage(trx, stale, ago(0, 25));
      await seed(trx, stale, "spam@bad.pl", spamMails());
      await refresh(trx, stale);
      expect(await rowsOf(trx, stale)).toEqual([]);

      const fresh = await suggestOrg(trx);
      await withSentCoverage(trx, fresh, ago(0, 23));
      await seed(trx, fresh, "spam@bad.pl", spamMails());
      await refresh(trx, fresh);
      expect(summary(await rowsOf(trx, fresh))).toEqual(["open:blocklist:address:spam@bad.pl"]);
    });
  });
});

describe("the suggestion step: domain rows", () => {
  const SPAMMERS = ["a@acme.pl", "b@acme.pl"];

  test("15 two senders of a domain that meet the block rule give one domain row; it withdraws the open address rows", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
      for (const address of SPAMMERS) {
        await insertSuggestion(trx, org, { value: address, kind: "blocklist", createdAt: ago(8) });
      }
      await refresh(trx, org);
      const rows = await rowsOf(trx, org);
      expect(summary(rows)).toEqual([
        "open:blocklist:domain:@acme.pl",
        "withdrawn:blocklist:address:null",
        "withdrawn:blocklist:address:null",
      ]);
      expect(rows.find((row) => row.status === "open")?.reason).toEqual({ corrected: 4, senders: 2 });
    });
  });

  test("15b a protected member (the user wrote to one) stops the domain row; the other address rows stay addresses", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
      await seed(trx, org, "friend@acme.pl", mails(3, 0), [{ at: ago(4), to: ["friend@acme.pl"] }]);
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual([
        "open:blocklist:address:a@acme.pl",
        "open:blocklist:address:b@acme.pl",
      ]);
    });
  });

  test("15c a free-mail domain and an own domain get address rows only; a shared hosting domain too", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      const ownDomain = org.address.split("@")[1] ?? "";
      for (const domain of ["gmail.com", ownDomain, "github.io"]) {
        for (const name of ["a", "b"]) await seed(trx, org, `${name}@${domain}`, spamMails());
      }
      await refresh(trx, org);
      const rows = await openOf(trx, org);
      // Six address rows would be made, but the cap is 3.
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.scope).toBe("address");
    });
  });

  test("16 a whitelist domain row ends when a member gets a suspicious mail; the two senders keep their own rows", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      for (const address of SPAMMERS) await seed(trx, org, address, rescuedMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:whitelist:domain:@acme.pl"]);
      await seed(trx, org, "c@acme.pl", [{ at: ago(1, 3), category: "info", suspicious: true }]);
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual([
        "open:whitelist:address:a@acme.pl",
        "open:whitelist:address:b@acme.pl",
        "withdrawn:whitelist:domain:null",
      ]);
    });
  });

  test("16c a blocklist domain row ends when the Sent coverage is lost", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      for (const address of SPAMMERS) await seed(trx, org, address, spamMails());
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual(["open:blocklist:domain:@acme.pl"]);
      // The last Sent pass is now 25 hours old at the next pass.
      await refresh(trx, org, new Date(NOW.getTime() + 25 * HOUR_MS));
      expect(summary(await rowsOf(trx, org))).toEqual(["withdrawn:blocklist:domain:null"]);
    });
  });

  test("16d an open blocklist domain row ends when the user adds a block rule for the domain (with Sent coverage on)", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await insertSuggestion(trx, org, { value: "@acme.pl", scope: "domain", kind: "blocklist", createdAt: ago(3) });
      await insertSuggestion(trx, org, { value: "@other.pl", scope: "domain", kind: "blocklist", createdAt: ago(3) });
      await insertSenderRule(trx, org.ctx, { mailboxId: null, pattern: "acme.pl", kind: "blocklist" });
      await refresh(trx, org);
      expect(summary(await rowsOf(trx, org))).toEqual([
        "open:blocklist:domain:@other.pl",
        "withdrawn:blocklist:domain:null",
      ]);
    });
  });

  test("16b an open domain row of a domain rule of the user ends; a rule for a parent domain covers it too", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await insertSuggestion(trx, org, {
        value: "@news.acme.pl",
        scope: "domain",
        kind: "whitelist",
        createdAt: ago(3),
      });
      await insertSuggestion(trx, org, { value: "@other.pl", scope: "domain", kind: "whitelist", createdAt: ago(3) });
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "acme.pl", kind: "whitelist" });
      await refresh(trx, org);
      expect(summary(await rowsOf(trx, org))).toEqual([
        "open:whitelist:domain:@other.pl",
        "withdrawn:whitelist:domain:null",
      ]);
    });
  });
});

describe("the suggestion step: eligibility and frozen mailboxes", () => {
  test("17 an address with an internationalized domain is never suggested and takes no weekly slot", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await seed(trx, org, "jan@bücher.de", mails(12, 12));
      for (const name of ["a", "b", "c"]) await seed(trx, org, `${name}@acme${name}.pl`, mails(8, 6));
      await refresh(trx, org);
      expect(summary(await openOf(trx, org))).toEqual([
        "open:vip:address:a@acmea.pl",
        "open:vip:address:b@acmeb.pl",
        "open:vip:address:c@acmec.pl",
      ]);
    });
  });

  test("18 a paused, auth_error or host_blocked mailbox gets no new row and its open rows are not touched", async () => {
    for (const status of ["paused", "auth_error", "host_blocked"] as const) {
      await withRollback(db, async (trx) => {
        const org = await suggestOrg(trx);
        await seed(trx, org, "anna@acme.pl", mails(8, 6));
        await refresh(trx, org);
        expect(await openOf(trx, org)).toHaveLength(1);
        await trx.updateTable("mailboxes").set({ status }).where("id", "=", org.mailboxId).execute();
        await seed(trx, org, "bob@corp.pl", mails(8, 6));
        await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "anna@acme.pl", kind: "vip" });
        await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
        // No new row for bob, and the covered row is not withdrawn: the step did not run.
        expect(summary(await rowsOf(trx, org))).toEqual(["open:vip:address:anna@acme.pl"]);
        // The profiles are still written (the job, not the pass, skips a mailbox that is not active).
        expect(
          await trx.selectFrom("sender_profiles").select("id").where("mailbox_id", "=", org.mailboxId).execute()
        ).toHaveLength(2);
      });
    }
  });
});

describe("the suggestion step: stored data", () => {
  test("19 an ended row holds no pattern, and no column of any row holds an address except the pattern of an open row", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await withSentCoverage(trx, org);
      await seed(trx, org, "anna@acme.pl", mails(8, 6));
      await seed(trx, org, "spam@bad.pl", spamMails());
      await seed(trx, org, "carl@corp.pl", rescuedMails());
      await refresh(trx, org);
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "anna@acme.pl", kind: "vip" });
      await insertSuggestion(trx, org, { value: "old@acme.pl", kind: "vip", createdAt: ago(40) });
      await refresh(trx, org, new Date(NOW.getTime() + HOUR_MS));
      const rows = await rowsOf(trx, org);
      expect(rows.length).toBeGreaterThanOrEqual(4);
      for (const row of rows) {
        const { pattern, ...rest } = row;
        expect(JSON.stringify(rest)).not.toContain("@");
        if (row.status !== "open") expect(pattern).toBeNull();
        else expect(pattern).toContain("@");
        expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });
  });
});
