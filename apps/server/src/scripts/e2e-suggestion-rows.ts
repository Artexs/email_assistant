import { senderKeyHash } from "../platform/crypto";
import type { Db, TenantContext } from "../platform/db";

import { E2E_SUGGESTIONS } from "./e2e-seed-args";

const DAY = 24 * 60 * 60_000;
const KEYS = ["vip", "blocklist", "whitelist"] as const;

// The rows of the suggestions spec for one organization: three open suggestions of the mailbox, `vip` the newest. The key is the
// keyed hash of the pattern, as the profile pass writes it. No activity stands behind them, so the pass of the e2e server (if it
// runs) leaves them open.
export async function seedSuggestionRows(
  db: Db,
  ctx: TenantContext,
  mailboxId: string,
  credentialsKey: string,
  now: Date
): Promise<void> {
  await db
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
          created_at: new Date(now.getTime() - (index + 1) * DAY),
        };
      })
    )
    .execute();
}
