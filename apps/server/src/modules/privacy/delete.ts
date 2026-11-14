import { orgNameMatches } from "@ea/core";
import { sql } from "kysely";

import type { Db } from "../../platform/db";
import { createLog } from "../../platform/log";

const log = createLog("privacy");

export type OrgDeleteResult =
  | { kind: "deleted"; mailboxAddresses: string[] }
  | { kind: "not_found" }
  | { kind: "name_mismatch" };

const NOT_FOUND_CODE = "P0002";
const DEADLOCK_CODE = "40P01";

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

// One transaction: lock the organization, check the typed name, read the mailbox addresses, lock the member users,
// call `delete_organization`. Nothing is written when the name differs. The mailbox addresses go to the caller only
// (the operator tells the owner which passwords to change); no log line holds them.
//
// Why the member users are locked (F106 stage 01 review, N4): the function deletes the users whose only membership is
// this organization. Its select takes no lock on the memberships table. An invite into another organization that commits
// during the delete would lose its new membership through the cascade of `users`. A `FOR UPDATE` on the member users
// conflicts with the `FOR KEY SHARE` that the foreign key of a new membership takes. So an insert that started before
// the lock commits first and the function (a later statement, so a new snapshot) sees it and keeps the user; an insert
// that starts after the lock waits and then fails its foreign key check. No membership is lost without an error.
// The locks go in the order organization, then users by id, so two deletes cannot block each other.
export async function deleteOrganization(
  db: Db,
  input: { orgId: string; confirmName: string; via: "web" | "cli" }
): Promise<OrgDeleteResult> {
  const { orgId } = input;
  const run = () =>
    db.transaction().execute(async (trx): Promise<OrgDeleteResult> => {
      const org = await trx
        .selectFrom("organizations")
        .select("name")
        .where("id", "=", orgId)
        .forUpdate()
        .executeTakeFirst();
      if (!org) return { kind: "not_found" };
      if (!orgNameMatches(org.name, input.confirmName)) return { kind: "name_mismatch" };

      const mailboxes = await trx.selectFrom("mailboxes").select("address").where("org_id", "=", orgId).execute();
      const mailboxAddresses = mailboxes.map((row) => row.address).sort();

      await sql`
        SELECT u.id FROM users u
        WHERE u.id IN (SELECT m.user_id FROM memberships m WHERE m.org_id = ${orgId}::uuid)
        ORDER BY u.id
        FOR UPDATE`.execute(trx);
      await sql`SELECT delete_organization(${orgId}::uuid)`.execute(trx);
      return { kind: "deleted", mailboxAddresses };
    });

  let result: OrgDeleteResult;
  try {
    try {
      result = await run();
    } catch (error) {
      if (codeOf(error) !== DEADLOCK_CODE) throw error;
      result = await run();
    }
  } catch (error) {
    if (codeOf(error) === NOT_FOUND_CODE) return { kind: "not_found" };
    throw error;
  }
  if (result.kind === "deleted") log.info("org_deleted", { org_id: orgId, kind: input.via });
  return result;
}
