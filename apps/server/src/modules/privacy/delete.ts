import { orgNameMatches } from "@ea/core";
import { sql } from "kysely";

import type { Db } from "../../platform/db";
import { createLog } from "../../platform/log";

const log = createLog("privacy");

export type OrgDeleteResult =
  | { kind: "deleted"; mailboxAddresses: string[] }
  | { kind: "not_found" }
  | { kind: "name_mismatch" }
  // A lock wait ran past the lock timeout (SQLSTATE 55P03). Nothing changed; the caller may try again.
  | { kind: "busy" };

/**
 * The result of a call with the `expect` option: it adds one outcome. A caller without `expect` never gets it, so the
 * web route and the CLI keep their exhaustive switches.
 */
export type OrgDeleteScopedResult = OrgDeleteResult | { kind: "scope_mismatch" };

/**
 * What the caller says the organization holds, checked INSIDE the delete transaction after the organization lock
 * (F113 stage 14 review, N1 and N2). A mailbox or a member that is outside these lists makes the delete return
 * `scope_mismatch` with nothing changed. The lock makes the check safe against a late insert: a mailbox row or a
 * membership that commits before the lock is seen by the check; one that starts later waits for the delete and then
 * fails its foreign key. Addresses and emails compare in lower case.
 */
export interface OrgDeleteExpect {
  mailboxes: readonly string[];
  memberEmails: readonly string[];
}

const NOT_FOUND_CODE = "P0002";
const DEADLOCK_CODE = "40P01";
const LOCK_TIMEOUT_CODE = "55P03";
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

const allIn = (values: readonly string[], allowed: readonly string[]): boolean => {
  const set = new Set(allowed.map((value) => value.toLowerCase()));
  return values.every((value) => set.has(value.toLowerCase()));
};

function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

// The caller checks the owner role (web) or is the operator (CLI), and takes `orgId` from the session or the operator,
// never from the request body.
//
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
interface DeleteInput {
  orgId: string;
  confirmName: string;
  via: "web" | "cli";
  lockTimeoutMs?: number;
}

export async function deleteOrganization(
  db: Db,
  input: DeleteInput & { expect: OrgDeleteExpect }
): Promise<OrgDeleteScopedResult>;
export async function deleteOrganization(db: Db, input: DeleteInput): Promise<OrgDeleteResult>;
export async function deleteOrganization(
  db: Db,
  input: DeleteInput & { expect?: OrgDeleteExpect }
): Promise<OrgDeleteScopedResult> {
  const { orgId } = input;
  const lockTimeoutMs = input.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const run = () =>
    db.transaction().execute(async (trx): Promise<OrgDeleteScopedResult> => {
      // `SET LOCAL`: a wait for a row lock (a mailbox job, an invite) ends with 55P03 instead of waiting without end.
      await sql`SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true)`.execute(trx);
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
      if (input.expect !== undefined) {
        const members = await trx
          .selectFrom("memberships")
          .innerJoin("users", "users.id", "memberships.user_id")
          .select("users.email")
          .where("memberships.org_id", "=", orgId)
          .execute();
        const mailboxesOk = allIn(mailboxAddresses, input.expect.mailboxes);
        const membersOk = allIn(
          members.map((row) => row.email),
          input.expect.memberEmails
        );
        if (!mailboxesOk || !membersOk) return { kind: "scope_mismatch" };
      }

      await sql`
        SELECT u.id FROM users u
        WHERE u.id IN (SELECT m.user_id FROM memberships m WHERE m.org_id = ${orgId}::uuid)
        ORDER BY u.id
        FOR UPDATE`.execute(trx);
      await sql`SELECT delete_organization(${orgId}::uuid)`.execute(trx);
      return { kind: "deleted", mailboxAddresses };
    });

  let result: OrgDeleteScopedResult;
  try {
    try {
      result = await run();
    } catch (error) {
      if (codeOf(error) !== DEADLOCK_CODE) throw error;
      result = await run();
    }
  } catch (error) {
    // Defence only: the function raises P0002 for an unknown id or another tenant scope, but the locked select above
    // already returns `not_found` for a missing organization, and this caller runs without a tenant scope.
    if (codeOf(error) === NOT_FOUND_CODE) return { kind: "not_found" };
    if (codeOf(error) === LOCK_TIMEOUT_CODE) return { kind: "busy" };
    throw error;
  }
  if (result.kind === "deleted") log.info("org_deleted", { org_id: orgId, kind: input.via });
  return result;
}
