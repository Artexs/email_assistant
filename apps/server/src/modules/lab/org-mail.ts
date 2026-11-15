import { countOrgEmails } from "../mail";
import type { Db } from "../../platform/db";

// True when the org holds any mail row. A measured run needs a fresh org (`org_not_fresh`).
export async function orgHasMail(db: Db, orgId: string): Promise<boolean> {
  return (await countOrgEmails(db, { orgId })) > 0;
}
