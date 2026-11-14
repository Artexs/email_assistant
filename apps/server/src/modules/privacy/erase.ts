import { sql, type Transaction } from "kysely";

import { dsrAddressHash, tombstoneKeyHash } from "../../platform/crypto";
import { withTenantScope, type DB, type Db } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

import { DSR_ADDRESS_MAP, normalizeDsrAddress } from "./address-map";
import { dsrAuditData, dsrCounts, type DsrCounts } from "./dsr";
import { addressPatterns, findOpenActions, matchSubject, rowCondition, type AddressPatterns } from "./dsr-match";
import { eraseManyMailOutbox } from "./outbox";

const DEADLOCK_CODE = "40P01";
const FOREIGN_KEY_CODE = "23503";
const LOCK_TIMEOUT_MS = 30_000;
const TOMBSTONE_BATCH = 500;

// What replaces an address in a text or a json value.
const REMOVED = "[removed]";

// A `CHECK (char_length(col) <= n)` of a scrubbed text column. The replacement can be longer than a short address, so
// the scrubbed value is cut to the limit.
const TEXT_LIMITS: Readonly<Record<string, number>> = {
  "email_headers.from_name": 200,
  "email_headers.auth_results": 1000,
  "outbox.text": 4096,
};

// One step inside the erase transaction, after the mails are deleted and before the scrub. The default is
// `eraseManyMailOutbox` (stored digests and approval sets); a test can pass another.
// It returns flat counts for the audit row. A throw rolls back the whole erase.
export type EraseStep = (
  trx: Transaction<DB>,
  orgId: string,
  erased: { mailIds: string[]; earliestCreatedAt: Date | null }
) => Promise<Record<string, number>>;

export type DsrEraseResult =
  | {
      kind: "erased";
      counts: DsrCounts;
      tombstones: number;
      // "table.column" → rows that the scrub changed; only keys with rows.
      scrubbed: Record<string, number>;
      stepCounts: Record<string, number>;
    }
  | { kind: "not_found" }
  | { kind: "own_address" }
  | { kind: "bad_address" }
  | { kind: "confirm_mismatch" }
  | { kind: "open_actions"; actionIds: string[] }
  // A foreign key that the erase did not expect stopped it (a bug): nothing changed.
  | { kind: "blocked"; constraint: string };

function errorField(error: unknown, field: "code" | "constraint"): unknown {
  return typeof error === "object" && error !== null && field in error
    ? (error as Record<string, unknown>)[field]
    : undefined;
}

// The new value of a column without the address, by the rule of the column. `t` is the alias of the table.
function cleanedValue(
  rule: "recipients" | "text" | "json" | "equal",
  key: string,
  column: string,
  patterns: AddressPatterns,
  nullable: boolean
) {
  const ref = sql.ref(`t.${column}`);
  switch (rule) {
    case "recipients":
      return sql`array(
        select u.v from unnest(${ref}) with ordinality as u(v, n) where lower(u.v) <> ${patterns.address} order by u.n
      )`;
    case "text": {
      const replaced = sql`regexp_replace(${ref}, ${patterns.text}, ${REMOVED}, 'gi')`;
      const limit = TEXT_LIMITS[key];
      return limit === undefined ? replaced : sql`left(${replaced}, ${limit})`;
    }
    case "json":
      return sql`regexp_replace(${ref}::text, ${patterns.json}, ${REMOVED}, 'gi')::jsonb`;
    case "equal":
      return nullable ? sql`null` : sql`''`;
  }
}

// "table.column" → true when the column accepts NULL (a `NOT NULL` column of the `equal` rule gets an empty value).
async function nullability(trx: Transaction<DB>): Promise<Record<string, boolean>> {
  const result = await sql<{ table_name: string; column_name: string; is_nullable: string }>`
    select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'`.execute(
    trx
  );
  return Object.fromEntries(
    result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable === "YES"])
  );
}

// Every kept row of the organization loses the address, by the rule of its column. Selected by the same condition as the
// match, so a row that the match shows is a row that the scrub changes. `sender` and `list` rows never change here (the
// mails that go are already deleted; the operator reads the listed rows).
async function scrubMentions(
  trx: Transaction<DB>,
  orgId: string,
  patterns: AddressPatterns
): Promise<Record<string, number>> {
  const nullable = await nullability(trx);
  const scrubbed: Record<string, number> = {};
  for (const [table, columns] of Object.entries(DSR_ADDRESS_MAP)) {
    for (const [column, rule] of Object.entries(columns)) {
      if (rule === "sender" || rule === "list") continue;
      const condition = rowCondition(rule, column, patterns);
      if (condition === null) continue;
      const key = `${table}.${column}`;
      const value = cleanedValue(rule, key, column, patterns, nullable[key] === true);
      const result = await sql`
        update ${sql.table(table)} as t set ${sql.id(column)} = ${value}
        where t.org_id = ${orgId}::uuid and ${condition}`.execute(trx);
      const changed = Number(result.numAffectedRows ?? 0n);
      if (changed > 0) scrubbed[key] = changed;
    }
  }
  return scrubbed;
}

async function insertTombstones(trx: Transaction<DB>, orgId: string, dedupKeys: string[]): Promise<number> {
  const hashes = [...new Set(dedupKeys.map(tombstoneKeyHash))];
  let inserted = 0;
  for (let i = 0; i < hashes.length; i += TOMBSTONE_BATCH) {
    const batch = hashes.slice(i, i + TOMBSTONE_BATCH);
    const result = await sql`
      insert into dsr_tombstones (org_id, key_hash)
      select ${orgId}::uuid, h from unnest(${batch}::text[]) as h
      on conflict do nothing`.execute(trx);
    inserted += Number(result.numAffectedRows ?? 0n);
  }
  return inserted;
}

// The erase of one person's data (F106 account data ticket), on the owner's instruction. One transaction, so a failure
// at any point changes nothing. Order: lock the organization; lock the sync folders (sync and backfill apply their chunks
// under this lock, so a chunk planned before the erase meets the tombstone); match; refuse; lock the mails that go;
// tombstones; delete the chain actions and the mails; the step of the outbox stage; scrub the kept rows; check that the
// match is empty; one audit row with the hash and counts.
// The module logs nothing and puts no address in a result or an error: the CLI prints ids and counts.
async function eraseInScope(
  db: Db,
  input: {
    orgId: string;
    address: string;
    confirm: string;
    credentialsKey: string;
    step?: EraseStep;
    now?: Date;
  }
): Promise<DsrEraseResult> {
  const address = normalizeDsrAddress(input.address);
  if (address === null) return { kind: "bad_address" };
  if (normalizeDsrAddress(input.confirm) !== address) return { kind: "confirm_mismatch" };
  const now = input.now ?? new Date();
  const { orgId } = input;

  const run = () =>
    db.transaction().execute(async (trx): Promise<DsrEraseResult> => {
      // A wait for a row lock ends with an error (nothing changed) instead of waiting without end.
      await sql`select set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}, true)`.execute(trx);
      // `FOR NO KEY UPDATE`: two erases and an organization delete take turns; mail work (a foreign-key share) goes on.
      const org = await trx
        .selectFrom("organizations")
        .select("id")
        .where("id", "=", orgId)
        .forNoKeyUpdate()
        .executeTakeFirst();
      if (!org) return { kind: "not_found" };
      await sql`select id from mailbox_folders where org_id = ${orgId}::uuid order by id for update`.execute(trx);

      const match = await matchSubject(trx, orgId, address);
      if (match.ownAddress) return { kind: "own_address" };
      if (match.openActions.length > 0) return { kind: "open_actions", actionIds: match.openActions };
      const counts = dsrCounts(match);

      // A new action on a mail that goes waits for this lock and then fails its foreign key: no open send slips in.
      const mailIds = match.mails.map((mail) => mail.id);
      const earliest = await sql<{ at: Date | null }>`
        select min(created_at) as at from (
          select created_at from emails
          where org_id = ${orgId}::uuid and id = any (${mailIds}::uuid[]) order by id for update
        ) as locked`.execute(trx);
      // The match ran before the lock. A writer that committed between the two (a triage job that added a send) is seen
      // only now, under the lock: ask again, and refuse with nothing deleted.
      const patterns = addressPatterns(address);
      const late = await findOpenActions(trx, orgId, patterns.json, mailIds, match.chainActions);
      if (late.length > 0) return { kind: "open_actions", actionIds: late };
      const tombstones = await insertTombstones(
        trx,
        orgId,
        match.mails.map((mail) => mail.dedupKey)
      );

      if (match.chainActions.length > 0) {
        await sql`delete from actions where org_id = ${orgId}::uuid and id = any (${match.chainActions}::uuid[])`.execute(
          trx
        );
      }
      if (mailIds.length > 0) {
        await sql`delete from emails where org_id = ${orgId}::uuid and id = any (${mailIds}::uuid[])`.execute(trx);
      }
      const step = input.step ?? eraseManyMailOutbox;
      const stepCounts = await step(trx, orgId, { mailIds, earliestCreatedAt: earliest.rows[0]?.at ?? null });
      const scrubbed = await scrubMentions(trx, orgId, patterns);

      // The erase must leave nothing that the match shows. If it does, roll back: a half erase is worse than none.
      const after = await matchSubject(trx, orgId, address);
      if (after.mails.length > 0 || Object.keys(after.mentions).length > 0) throw new Error("dsr_erase_incomplete");

      await recordAudit(
        trx,
        { orgId },
        {
          actor: "cli",
          event: auditEvents.dsrErase,
          data: {
            ...dsrAuditData(dsrAddressHash(input.credentialsKey, address), counts),
            tombstones,
            chain_actions: counts.chain_actions,
            chain_delegations: counts.chain_delegations,
            ...stepCounts,
          },
          at: now,
        }
      );
      return { kind: "erased", counts, tombstones, scrubbed, stepCounts };
    });

  try {
    try {
      return await run();
    } catch (error) {
      if (errorField(error, "code") !== DEADLOCK_CODE) throw error;
      return await run();
    }
  } catch (error) {
    if (errorField(error, "code") === FOREIGN_KEY_CODE) {
      const constraint = errorField(error, "constraint");
      return { kind: "blocked", constraint: typeof constraint === "string" ? constraint : "unknown" };
    }
    throw error;
  }
}

// The erase runs in the tenant scope of its organization, so the row-level policies back up the `org_id` filter of every
// query here: a missing filter cannot reach another organization.
export function eraseSubjectData(db: Db, input: Parameters<typeof eraseInScope>[1]): Promise<DsrEraseResult> {
  if (input.orgId === "") return Promise.resolve({ kind: "not_found" });
  return withTenantScope(input.orgId, () => eraseInScope(db, input));
}
