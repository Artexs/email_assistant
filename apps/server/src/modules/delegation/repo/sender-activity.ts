import { sql } from "kysely";

import { normalizedAddress, type TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

// Reader of the sender activity pass (`contacts`) over the delegation tables. It filters `org_id` on both tables. Addresses come
// back in the rule form and stay in memory: no log line carries an address or a count with one.

export interface DelegationCountOptions {
  mailboxId: string;
  // Delegations created in `[since, until]` count.
  since: Date;
  until: Date;
}

export interface DelegationCount {
  // The delegate's e-mail in the rule form.
  address: string;
  delegations: number;
}

// The delegations of the mailbox, counted per address of their delegate. An inactive delegate has no row.
export async function delegationCountsByDelegateAddress(
  db: DbOrTrx,
  ctx: TenantContext,
  options: DelegationCountOptions
): Promise<DelegationCount[]> {
  const address = normalizedAddress("d.email");
  const rows = await db
    .selectFrom("delegations as dn")
    .innerJoin("delegates as d", (join) =>
      join.onRef("d.id", "=", "dn.delegate_id").onRef("d.org_id", "=", "dn.org_id")
    )
    .select([sql<string>`${address}`.as("address"), sql<number>`count(*)::int`.as("delegations")])
    .where("dn.org_id", "=", ctx.orgId)
    .where("dn.mailbox_id", "=", options.mailboxId)
    .where("dn.created_at", ">=", options.since)
    .where("dn.created_at", "<=", options.until)
    .where("d.active", "=", true)
    .groupBy(address)
    .execute();
  return rows.map((row) => ({ address: row.address, delegations: Number(row.delegations) }));
}
