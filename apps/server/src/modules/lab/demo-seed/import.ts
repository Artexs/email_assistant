import { randomUUID } from "node:crypto";

import { sql, type Transaction } from "kysely";

import type { DB, Db } from "../../../platform/db";
import { deleteOrganization } from "../../privacy";
import { insertMembership, insertUser } from "../../tenancy";

import { checkDemoSeed } from "./format";
import { findNonTestAddress, findRealHost } from "./scan";
import { DEMO_TABLES, TABLE_SPECS, type DemoRow, type DemoTable } from "./tables";
import { buildImportRows } from "./transform";
import { DemoSeedError, IMPORT_ORG_NAME, type DemoSeed } from "./types";

const BATCH_ROWS = 200;

export interface ImportOptions {
  ownerEmail: string;
  /** Delete an earlier import (the org named `IMPORT_ORG_NAME`) first, in its own transaction. */
  replace: boolean;
  /** `SEND_SCOPE` of the environment. `all` refuses the import. */
  sendScope: string;
  now?: Date;
}

export interface ImportResult {
  orgId: string;
  rows: Record<DemoTable, number>;
}

// One multi-row insert. A JSON column goes in as text; `pg` gives the column type to the parameter.
async function insertRows(
  trx: Transaction<DB>,
  table: string,
  rows: DemoRow[],
  jsonColumns: readonly string[]
): Promise<void> {
  const first = rows[0];
  if (first === undefined) return;
  const columns = Object.keys(first);
  const names = sql.join(columns.map((column) => sql.ref(column)));
  for (let at = 0; at < rows.length; at += BATCH_ROWS) {
    const batch = rows.slice(at, at + BATCH_ROWS);
    const values = sql.join(
      batch.map((row) => {
        const cells = columns.map((column) => {
          const value = row[column];
          return jsonColumns.includes(column) && value !== null ? JSON.stringify(value) : value;
        });
        return sql`(${sql.join(cells)})`;
      })
    );
    await sql`insert into ${sql.table(table)} (${names}) values ${values}`.execute(trx);
  }
}

// An earlier import of this seed is replaced only when it is clearly the same kind of org: exactly one org with the
// import name, only the owner as a member, only the mailboxes of the seed. The check runs again inside the delete
// transaction (`expect`), so a late member or mailbox stops the delete.
async function replaceEarlierImport(db: Db, seed: DemoSeed, ownerEmail: string): Promise<void> {
  const named = await sql<{ id: string }>`select id from organizations where name = ${IMPORT_ORG_NAME}`.execute(db);
  if (named.rows.length > 1) throw new DemoSeedError("replace_ambiguous");
  const old = named.rows[0];
  if (old === undefined) return;
  const result = await deleteOrganization(db, {
    orgId: old.id,
    confirmName: IMPORT_ORG_NAME,
    via: "cli",
    expect: { mailboxes: seed.tables.mailboxes.map((row) => String(row.address)), memberEmails: [ownerEmail] },
  });
  if (result.kind === "name_mismatch" || result.kind === "scope_mismatch" || result.kind === "busy") {
    throw new DemoSeedError("replace_refused");
  }
}

/**
 * Loads a seed into `db` as a NEW organization. It never changes an existing organization. Refuses, with nothing
 * written: `SEND_SCOPE=all`; a seed with a bad shape, a row of another organization, an address outside `.test` or a
 * mailbox host that is not a loopback or `.test` name; a seed whose organization id exists in this database; an
 * earlier import without `replace`.
 *
 * The new organization is "Kordelan demo (import)" with new ids everywhere; its mailboxes are `paused` with a
 * placeholder secret, open actions are `expired`, unsent outbox rows are dropped, and no Telegram link exists. The
 * owner is the user with `ownerEmail` (made when missing). The insert is one transaction. With `replace`, the earlier
 * import is deleted first in its own transaction (the privacy delete): a failed insert after it leaves no import.
 */
export async function importDemo(db: Db, input: DemoSeed, opts: ImportOptions): Promise<ImportResult> {
  if (opts.sendScope === "all") throw new DemoSeedError("import_needs_safe_send_scope");
  const seed = checkDemoSeed(input);
  for (const table of DEMO_TABLES) {
    const column = findNonTestAddress(seed.tables[table]);
    if (column !== undefined) throw new DemoSeedError("non_test_address", table, column);
  }
  const hostColumn = findRealHost(seed.tables.mailboxes);
  if (hostColumn !== undefined) throw new DemoSeedError("real_host", "mailboxes", hostColumn);

  const ownerEmail = opts.ownerEmail.trim().toLowerCase();
  const sourceOrgId = String(seed.tables.organizations[0]?.id);
  const existing = await sql<{ id: string }>`select id from organizations where id = ${sourceOrgId}::uuid`.execute(db);
  if (existing.rows.length > 0) throw new DemoSeedError("org_id_exists", "organizations", "id");
  const named = await sql<{ id: string }>`select id from organizations where name = ${IMPORT_ORG_NAME} limit 1`.execute(
    db
  );
  if (named.rows.length > 0) {
    if (!opts.replace) throw new DemoSeedError("import_exists");
    await replaceEarlierImport(db, seed, ownerEmail);
  }

  const now = opts.now ?? new Date();
  const orgId = randomUUID();
  return db.transaction().execute(async (trx) => {
    const found = await sql<{ id: string }>`select id from users where lower(email) = ${ownerEmail}`.execute(trx);
    const ownerId = found.rows[0]?.id ?? (await insertUser(trx, { email: ownerEmail, displayName: "Demo owner" })).id;
    const { rows, credentials } = buildImportRows(seed, { orgId, ownerId, now, newId: randomUUID });

    await insertRows(trx, "organizations", rows.organizations, TABLE_SPECS.organizations.json);
    await insertMembership(trx, { orgId }, { userId: ownerId, role: "owner" });
    for (const table of DEMO_TABLES) {
      if (table === "organizations") continue;
      await insertRows(trx, table, rows[table], TABLE_SPECS[table].json);
      if (table === "mailboxes") await insertRows(trx, "mailbox_credentials", credentials, []);
    }
    return {
      orgId,
      rows: Object.fromEntries(DEMO_TABLES.map((table) => [table, rows[table].length])) as Record<DemoTable, number>,
    };
  });
}
