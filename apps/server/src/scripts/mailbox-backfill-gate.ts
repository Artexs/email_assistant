import type { Transaction } from "kysely";

import { isOrgSuspended } from "../modules/tenancy";
import type { DB, Db } from "../platform/db";

// The refusal text of `mailbox:backfill` for a suspended organization, else undefined.
// It holds the org id and a code only, never a name, an address or mail text.
export async function backfillRefusal(db: Db | Transaction<DB>, orgId: string): Promise<string | undefined> {
  if (!(await isOrgSuspended(db, { orgId }))) return undefined;
  return `organization ${orgId} is suspended: org_suspended. Resume it with org:plan first.`;
}
