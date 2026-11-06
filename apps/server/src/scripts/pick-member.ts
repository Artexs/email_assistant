import { listMemberships } from "../modules/tenancy";
import type { Db } from "../platform/db";
import type { createLog } from "../platform/log";

// Without --user-id the organization must have exactly one member. Returns undefined after it logged why not.
export async function pickMemberId(
  db: Db,
  orgId: string,
  userId: string | undefined,
  log: ReturnType<typeof createLog>
): Promise<string | undefined> {
  if (userId !== undefined) return userId;
  const members = await listMemberships(db, { orgId });
  if (members.length === 1 && members[0]) return members[0].user_id;
  if (members.length === 0) {
    log.error("the organization has no members");
  } else {
    log.error(`the organization has ${members.length} members: pass --user-id`);
  }
  return undefined;
}
