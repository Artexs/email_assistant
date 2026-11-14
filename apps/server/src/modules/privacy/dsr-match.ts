import { sql, type RawBuilder, type Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";

import { addressRegex, DSR_ADDRESS_MAP, normalizeDsrAddress, type AddressRule } from "./address-map";

type DbOrTrx = Db | Transaction<DB>;

export interface DsrMatch {
  // The address is a mailbox of the organization or the e-mail of a member: the other fields stay empty.
  ownAddress: boolean;
  // Mails that go with the person (the person's own mail, a contact form, or mail between the person and us only).
  mails: { id: string; dedupKey: string }[];
  // "table.column" → ids of the rows of kept mails (or of no mail) that name the address.
  mentions: Record<string, string[]>;
  // Rows that the operator reads and the owner decides on; never changed by an erase.
  listed: { delegates: string[]; senderRules: string[] };
  // Actions that block an erase: still open, and tied to the person.
  openActions: string[];
  // Actions of kept mails that point, over any number of steps, at an action of a mail that goes (these foreign keys
  // have no cascade, so an erase deletes them first).
  chainActions: string[];
  // Delegations of kept mails whose draft or send action is deleted by the erase (an action of a mail that goes, or a
  // chain action): the foreign keys cascade, so the delegation goes with the action. Counted, never a surprise.
  chainDelegations: string[];
}

// The key of a row (`id`) and the column that names its mail (`emailId`; null in an outbox row of no mail) for each
// table that a mention reads.
const ROW_SHAPE: Readonly<Record<string, { id: string; emailId: string }>> = {
  emails: { id: "id", emailId: "id" },
  email_headers: { id: "email_id", emailId: "email_id" },
  triage_results: { id: "id", emailId: "email_id" },
  actions: { id: "id", emailId: "email_id" },
  outbox: { id: "id", emailId: "email_id" },
  delegations: { id: "id", emailId: "email_id" },
};

// Tables of the `list` rule and the field of `DsrMatch.listed` that each fills.
const LIST_FIELD: Readonly<Record<string, keyof DsrMatch["listed"]>> = {
  delegates: "delegates",
  sender_rules: "senderRules",
};

// Statuses of an action that has ended; every other status is open.
const ENDED_STATUSES = ["applied", "rejected", "expired", "undone", "logged", "failed"] as const;

export interface AddressPatterns {
  address: string;
  text: string;
  json: string;
}

export function addressPatterns(address: string): AddressPatterns {
  return { address, text: addressRegex(address), json: addressRegex(address, { json: true }) };
}

// The test of one row of table alias `t` against the address, by the rule of the column. null for `sender` and `list`.
export function rowCondition(rule: AddressRule, column: string, patterns: AddressPatterns): RawBuilder<boolean> | null {
  const { address } = patterns;
  const ref = sql.ref(`t.${column}`);
  switch (rule) {
    case "recipients":
      return sql<boolean>`exists (select 1 from unnest(${ref}) as v where lower(v) = ${address})`;
    case "text":
      return sql<boolean>`${ref} ~* ${patterns.text}`;
    case "json":
      return sql<boolean>`${ref}::text ~* ${patterns.json}`;
    case "equal":
      return sql<boolean>`lower(${ref}) = ${address}`;
    case "sender":
    case "list":
      return null;
  }
}

async function findMails(db: DbOrTrx, orgId: string, address: string): Promise<{ id: string; dedupKey: string }[]> {
  // One mail gets one answer: the test reads only the mail and the addresses of the organization, never the mailbox
  // that holds this copy. The Reply-To rule: the person is the only Reply-To (a contact form).
  const result = await sql<{ id: string; dedup_key: string }>`
    with own as (
      select coalesce(array_agg(lower(address)), '{}') as addresses from mailboxes where org_id = ${orgId}::uuid
    )
    select e.id::text as id, e.dedup_key
    from emails e
    left join email_headers h on h.email_id = e.id and h.org_id = e.org_id
    cross join own
    where e.org_id = ${orgId}::uuid
      and (
        lower(e.from_address) = ${address}
        or (cardinality(h.reply_to) = 1 and lower(h.reply_to[1]) = ${address})
        or (
          exists (select 1 from unnest(e.to_addresses || e.cc_addresses) as v where lower(v) = ${address})
          and not exists (
            select 1
            from unnest(array_prepend(e.from_address, e.to_addresses || e.cc_addresses)) as v
            where v is not null and lower(v) <> ${address} and lower(v) <> all (own.addresses)
          )
        )
      )
    order by e.id`.execute(db);
  return result.rows.map((row) => ({ id: row.id, dedupKey: row.dedup_key }));
}

async function findMentions(
  db: DbOrTrx,
  orgId: string,
  patterns: AddressPatterns,
  goes: string[]
): Promise<Record<string, string[]>> {
  const mentions: Record<string, string[]> = {};
  for (const [table, columns] of Object.entries(DSR_ADDRESS_MAP)) {
    for (const [column, rule] of Object.entries(columns)) {
      const match = rowCondition(rule, column, patterns);
      if (match === null) continue;
      const shape = ROW_SHAPE[table];
      if (!shape) throw new Error(`dsr_match_no_row_shape:${table}`);
      const result = await sql<{ id: string }>`
        select ${sql.ref(`t.${shape.id}`)}::text as id
        from ${sql.table(table)} as t
        where t.org_id = ${orgId}::uuid
          and ${match}
          and (${sql.ref(`t.${shape.emailId}`)} is null or not (${sql.ref(`t.${shape.emailId}`)} = any (${goes}::uuid[])))
        order by 1`.execute(db);
      if (result.rows.length > 0) mentions[`${table}.${column}`] = result.rows.map((row) => row.id);
    }
  }
  return mentions;
}

async function findListed(db: DbOrTrx, orgId: string, address: string): Promise<DsrMatch["listed"]> {
  const listed: DsrMatch["listed"] = { delegates: [], senderRules: [] };
  for (const [table, columns] of Object.entries(DSR_ADDRESS_MAP)) {
    const field = LIST_FIELD[table];
    const names = Object.entries(columns)
      .filter(([, rule]) => rule === "list")
      .map(([column]) => column);
    if (names.length === 0) continue;
    if (!field) throw new Error(`dsr_match_no_list_field:${table}`);
    const any = sql.join(
      names.map((column) => sql<boolean>`lower(${sql.ref(`t.${column}`)}) = ${address}`),
      sql` or `
    );
    const result = await sql<{ id: string }>`
      select t.id::text as id from ${sql.table(table)} as t where t.org_id = ${orgId}::uuid and (${any}) order by t.id`.execute(
      db
    );
    listed[field] = result.rows.map((row) => row.id);
  }
  return listed;
}

// A chain action that is `applying` is open too: the erase would delete an action that a worker is running.
export async function findOpenActions(
  db: DbOrTrx,
  orgId: string,
  regex: string,
  goes: string[],
  chain: string[]
): Promise<string[]> {
  const result = await sql<{ id: string }>`
    select a.id::text as id
    from actions a
    where a.org_id = ${orgId}::uuid
      and a.status <> all (${[...ENDED_STATUSES]}::text[])
      and (
        (a.email_id = any (${goes}::uuid[]) and (a.status = 'applying' or a.type in ('send', 'create_draft')))
        or (not (a.email_id = any (${goes}::uuid[])) and a.payload::text ~* ${regex})
        or (a.id = any (${chain}::uuid[]) and a.status = 'applying')
      )
    order by a.id`.execute(db);
  return result.rows.map((row) => row.id);
}

// Actions that the erase deletes besides those of the mails that go: the ones of kept mails that depend on or reverse an
// action of a mail that goes, and then the ones that depend on or reverse those, and so on (a recursive query). Then the
// delegations of kept mails that name any deleted action (their foreign keys cascade).
async function findChains(
  db: DbOrTrx,
  orgId: string,
  goes: string[]
): Promise<{ actions: string[]; delegations: string[] }> {
  const actions = await sql<{ id: string }>`
    with recursive chain(id) as (
      select a.id
      from actions a
      join actions b on b.org_id = a.org_id and (b.id = a.depends_on_action_id or b.id = a.reverses_action_id)
      where a.org_id = ${orgId}::uuid
        and not (a.email_id = any (${goes}::uuid[]))
        and b.email_id = any (${goes}::uuid[])
      union
      select a.id
      from actions a
      join chain c on (a.depends_on_action_id = c.id or a.reverses_action_id = c.id)
      where a.org_id = ${orgId}::uuid
        and not (a.email_id = any (${goes}::uuid[]))
    )
    select id::text as id from chain order by 1`.execute(db);
  const ids = actions.rows.map((row) => row.id);
  const delegations = await sql<{ id: string }>`
    select d.id::text as id
    from delegations d
    where d.org_id = ${orgId}::uuid
      and not (d.email_id = any (${goes}::uuid[]))
      and (
        d.draft_action_id = any (${ids}::uuid[]) or d.send_action_id = any (${ids}::uuid[])
        or exists (
          select 1 from actions a
          where a.org_id = d.org_id and a.email_id = any (${goes}::uuid[])
            and (a.id = d.draft_action_id or a.id = d.send_action_id)
        )
      )
    order by 1`.execute(db);
  return { actions: ids, delegations: delegations.rows.map((row) => row.id) };
}

async function isOwnAddress(db: DbOrTrx, orgId: string, address: string): Promise<boolean> {
  const result = await sql<{ own: boolean }>`
    select (
      exists (select 1 from mailboxes where org_id = ${orgId}::uuid and lower(address) = ${address})
      or exists (
        select 1 from memberships m join users u on u.id = m.user_id
        where m.org_id = ${orgId}::uuid and lower(u.email) = ${address}
      )
    ) as own`.execute(db);
  return result.rows[0]?.own === true;
}

// What an erase for one address would touch, read-only. Every query filters by `org_id`; nothing is written.
// The address goes to the database as a parameter and into no error text.
export async function matchSubject(db: DbOrTrx, orgId: string, address: string): Promise<DsrMatch> {
  const normalized = normalizeDsrAddress(address);
  if (normalized === null) throw new Error("dsr_match_invalid_address");
  if (await isOwnAddress(db, orgId, normalized)) {
    return {
      ownAddress: true,
      mails: [],
      mentions: {},
      listed: { delegates: [], senderRules: [] },
      openActions: [],
      chainActions: [],
      chainDelegations: [],
    };
  }
  const patterns = addressPatterns(normalized);
  const mails = await findMails(db, orgId, normalized);
  const goes = mails.map((mail) => mail.id);
  const chains = await findChains(db, orgId, goes);
  return {
    ownAddress: false,
    mails,
    mentions: await findMentions(db, orgId, patterns, goes),
    listed: await findListed(db, orgId, normalized),
    openActions: await findOpenActions(db, orgId, patterns.json, goes, chains.actions),
    chainActions: chains.actions,
    chainDelegations: chains.delegations,
  };
}
