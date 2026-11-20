import { listMemberships } from "../../modules/tenancy";
import type { CliOutput } from "../../platform/cli";
import type { Db } from "../../platform/db";

// Without --user-id the organization must have exactly one member. Returns undefined after it logged why not.
export async function pickMemberId(
  db: Db,
  orgId: string,
  userId: string | undefined,
  out: CliOutput
): Promise<string | undefined> {
  if (userId !== undefined) return userId;
  const members = await listMemberships(db, { orgId });
  if (members.length === 1 && members[0]) return members[0].user_id;
  if (members.length === 0) {
    out.fail("the organization has no members");
  } else {
    out.fail(`the organization has ${members.length} members: pass --user-id`);
  }
  return undefined;
}
