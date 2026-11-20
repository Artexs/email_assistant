import { afterAll, describe, expect, test } from "bun:test";

import { insertSenderRule } from "../../src/modules/config/repo";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { E2E_SUGGESTIONS } from "../../src/scripts/e2e-seed-args";
import { seedSuggestionRows } from "../../src/scripts/lib/e2e-suggestion-rows";

import { KEY, NOW, openOf, refresh, rowsOf, suggestOrg, summary } from "./contacts-fixtures";
import { testDb, withRollback } from "./helpers";

// The rows of the e2e suggestions spec. The e2e server runs the profile pass at minute 7 of every hour; a blocklist row needs Sent
// coverage, so the seed gives the mailbox some, and the reset before each test gives it again.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const EXPECTED = [
  `open:vip:address:${E2E_SUGGESTIONS.vip.pattern}`,
  `open:blocklist:address:${E2E_SUGGESTIONS.blocklist.pattern}`,
  `open:whitelist:domain:${E2E_SUGGESTIONS.whitelist.pattern}`,
];

describe("seedSuggestionRows", () => {
  test("1 the three rows survive the profile pass: the mailbox has Sent coverage, so the blocklist row is not withdrawn", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
      await seedSuggestionRows(trx, org.ctx, org.mailboxId, KEY, NOW);
      await refresh(trx, org);
      expect(summary(await openOf(trx, org)).sort()).toEqual([...EXPECTED].sort());
    });
  });

  test("2 a second call is a reset: the rows are three again, a dismissed row is back, a rule is gone", async () => {
    await withRollback(db, async (trx) => {
      const org = await suggestOrg(trx);
      await upsertOrgFeature(trx, org.ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: NOW });
      await seedSuggestionRows(trx, org.ctx, org.mailboxId, KEY, NOW);
      await trx
        .updateTable("sender_suggestions")
        .set({ status: "dismissed", pattern: null, ended_at: NOW })
        .where("mailbox_id", "=", org.mailboxId)
        .where("kind", "=", "vip")
        .execute();
      await insertSenderRule(trx, org.ctx, { mailboxId: org.mailboxId, pattern: "boss@client.test", kind: "vip" });
      await seedSuggestionRows(trx, org.ctx, org.mailboxId, KEY, NOW);
      expect(summary(await rowsOf(trx, org)).sort()).toEqual([...EXPECTED].sort());
      const rules = await trx.selectFrom("sender_rules").select("id").where("org_id", "=", org.ctx.orgId).execute();
      expect(rules).toEqual([]);
    });
  });
});
