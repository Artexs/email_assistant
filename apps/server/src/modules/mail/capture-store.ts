import { sql } from "kysely";

import type { TenantContext } from "../../platform/db";

import type { CapturedHeaders } from "./port";
import { insertEmailHeaders } from "./repo";
import type { DbOrTrx } from "./repo/shared";

// Stores the capture of a mail that the caller just inserted, inside the caller's transaction.
// The insert runs in a savepoint (raw SQL: the chunk transaction is not a Kysely-controlled one, and a test may pass a
// transaction already). A database error rolls back only the header row, never the mail row or the cursor.
// Returns false when no row came out of it; the caller counts that as a missing capture.
export async function storeCapture(
  trx: DbOrTrx,
  ctx: TenantContext,
  mail: { mailboxId: string; dedupKey: string },
  capture: CapturedHeaders,
  capturedAt: Date
): Promise<boolean> {
  await sql`savepoint capture_row`.execute(trx);
  try {
    const stored = await insertEmailHeaders(trx, ctx, mail, capture, capturedAt);
    await sql`release savepoint capture_row`.execute(trx);
    return stored;
  } catch {
    await sql`rollback to savepoint capture_row`.execute(trx);
    // Rolling back keeps the savepoint: release it, so savepoints do not pile up in a long chunk.
    await sql`release savepoint capture_row`.execute(trx);
    return false;
  }
}
