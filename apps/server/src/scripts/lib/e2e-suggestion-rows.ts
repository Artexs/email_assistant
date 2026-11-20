import { DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { insertSentSyncState, markSentPass, updateSentCursor } from "../../modules/mail";
import { senderKeyHash } from "../../platform/crypto";
import type { DB, Db, TenantContext } from "../../platform/db";
import { E2E_SUGGESTIONS } from "../e2e-seed-args";

import { inTransaction } from "./e2e-activity-rows";

const KEYS = ["vip", "blocklist", "whitelist"] as const;

// The rows of the suggestions spec for one organization: three open suggestions of the mailbox, `vip` the newest, and no sender
// rule. The key is the keyed hash of the pattern, as the profile pass writes it. No activity stands behind the rows, so the profile
// pass of the e2e server (hourly, at minute 7) keeps a row open only while nothing protects its sender: a blocklist row needs Sent
// coverage (the flag `sent_sync` on, the mailbox switch on, a first pass, and a pass in the last 24 hours without an error). The
// seed gives the mailbox that coverage, and the spec calls the reset before each test, so each test starts with all three rows
// and with fresh coverage whatever ran before it.
export async function seedSuggestionRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  credentialsKey: string,
  now: Date
): Promise<void> {
  await inTransaction(db, async (trx) => {
    await trx.deleteFrom("sender_suggestions").where("org_id", "=", ctx.orgId).execute();
    await trx.deleteFrom("sender_rules").where("org_id", "=", ctx.orgId).execute();
    await trx
      .insertInto("sender_suggestions")
      .values(
        KEYS.map((key, index) => {
          const row = E2E_SUGGESTIONS[key];
          return {
            org_id: ctx.orgId,
            mailbox_id: mailboxId,
            key_hash: senderKeyHash(credentialsKey, ctx.orgId, row.pattern),
            scope: row.scope,
            kind: row.kind,
            pattern: row.pattern,
            reason: JSON.stringify(row.reason),
            status: "open",
            created_at: new Date(now.getTime() - (index + 1) * DAY_MS),
          };
        })
      )
      .execute();
    // The Sent coverage: a switch that is on, a first pass 30 days ago and a pass now.
    await insertSentSyncState(trx, ctx, mailboxId, { enabled: true });
    await updateSentCursor(
      trx,
      ctx,
      mailboxId,
      { uidValidity: 1, lastUid: 1 },
      { firstPassAt: new Date(now.getTime() - 30 * DAY_MS) }
    );
    await markSentPass(trx, ctx, mailboxId, { at: now, errorCode: null });
  });
}
