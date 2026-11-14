import { unlink } from "node:fs/promises";

import { sql, type Transaction } from "kysely";

import { dsrAddressHash } from "../../platform/crypto";
import type { DB, Db } from "../../platform/db";
import { auditEvents, recordAudit, type AuditData } from "../audit";

import { normalizeDsrAddress } from "./address-map";
import { matchSubject, type DsrMatch } from "./dsr-match";
import { writeEncryptedFile } from "./encrypted-file";

const MAIL_BATCH = 200;

export interface DsrCounts {
  mails: number;
  // "table.column" → number of rows; only keys with rows.
  mentions: Record<string, number>;
  listed: { delegates: number; sender_rules: number };
  open_actions: number;
  chain_actions: number;
  chain_delegations: number;
}

export function dsrCounts(match: DsrMatch): DsrCounts {
  return {
    mails: match.mails.length,
    mentions: Object.fromEntries(Object.entries(match.mentions).map(([key, ids]) => [key, ids.length])),
    listed: { delegates: match.listed.delegates.length, sender_rules: match.listed.senderRules.length },
    open_actions: match.openActions.length,
    chain_actions: match.chainActions.length,
    chain_delegations: match.chainDelegations.length,
  };
}

export function dsrMentionTotal(counts: DsrCounts): number {
  return Object.values(counts.mentions).reduce((sum, n) => sum + n, 0);
}

// True when the address matches no row at all: the operator probably mistyped it.
export function dsrIsEmpty(counts: DsrCounts): boolean {
  return (
    counts.mails === 0 &&
    dsrMentionTotal(counts) === 0 &&
    counts.listed.delegates === 0 &&
    counts.listed.sender_rules === 0 &&
    counts.open_actions === 0 &&
    counts.chain_actions === 0 &&
    counts.chain_delegations === 0
  );
}

// Flat audit data (`AuditData` allows no nested object). Never the address; the hash only.
export function dsrAuditData(addressHash: string, counts: DsrCounts): AuditData {
  return {
    address_hash: addressHash,
    mails: counts.mails,
    mentions: dsrMentionTotal(counts),
    listed_delegates: counts.listed.delegates,
    listed_sender_rules: counts.listed.sender_rules,
    open_actions: counts.open_actions,
  };
}

export type DsrFindResult =
  | { kind: "found"; counts: DsrCounts; reportBytes: number | null }
  | { kind: "not_found" }
  | { kind: "own_address" }
  | { kind: "bad_address" }
  | { kind: "exists" };

// The report file: the whole mail of each mail that goes, in batches. For kept rows only table, column and id.
async function* reportChunks(
  trx: Transaction<DB>,
  input: { orgId: string; address: string; now: Date },
  match: DsrMatch
): AsyncGenerator<string> {
  yield `{"format":"ea-dsr-report","version":1,"org_id":${JSON.stringify(input.orgId)},"made_at":${JSON.stringify(input.now.toISOString())},"address":${JSON.stringify(input.address)},"mails":[`;
  const ids = match.mails.map((mail) => mail.id);
  for (let i = 0; i < ids.length; i += MAIL_BATCH) {
    const batch = ids.slice(i, i + MAIL_BATCH);
    const { rows } = await sql<Record<string, unknown>>`
      select e.id, e.mailbox_id, e.received_at, e.from_address, e.to_addresses, e.cc_addresses, e.subject, e.body_text,
        (
          select t.category from triage_results t
          where t.org_id = e.org_id and t.email_id = e.id
          order by t.created_at desc, t.id desc limit 1
        ) as category
      from emails e
      where e.org_id = ${input.orgId}::uuid and e.id = any (${batch}::uuid[])
      order by e.id`.execute(trx);
    yield `${i > 0 ? "," : ""}${rows.map((row) => JSON.stringify(row)).join(",")}`;
  }
  const delegates = await sql<Record<string, unknown>>`
    select id, name, email from delegates
    where org_id = ${input.orgId}::uuid and id = any (${match.listed.delegates}::uuid[]) order by id`.execute(trx);
  const rules = await sql<Record<string, unknown>>`
    select id, kind, pattern from sender_rules
    where org_id = ${input.orgId}::uuid and id = any (${match.listed.senderRules}::uuid[]) order by id`.execute(trx);
  yield `],"mentions":${JSON.stringify(match.mentions)},"listed":${JSON.stringify({ delegates: delegates.rows, sender_rules: rules.rows })},"open_actions":${JSON.stringify(match.openActions)}}`;
}

// The dry run for one address (F106 account data ticket). One `REPEATABLE READ READ ONLY` transaction reads the match
// and the optional report, so the counts and the file are one snapshot. The one audit row (`dsr.find`) comes after the
// file is complete; if it fails the file goes too. The address is in the report file only, which is encrypted.
// A refusal writes no audit row. The module logs nothing: the CLI prints ids, counts and sizes.
export async function findSubjectData(
  db: Db,
  input: {
    orgId: string;
    address: string;
    credentialsKey: string;
    report?: { recipient: string; out: string };
    now?: Date;
  }
): Promise<DsrFindResult> {
  const address = normalizeDsrAddress(input.address);
  if (address === null) return { kind: "bad_address" };
  const now = input.now ?? new Date();

  const result = await db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (trx): Promise<DsrFindResult> => {
      const org = await trx.selectFrom("organizations").select("id").where("id", "=", input.orgId).executeTakeFirst();
      if (!org) return { kind: "not_found" };
      const match = await matchSubject(trx, input.orgId, address);
      if (match.ownAddress) return { kind: "own_address" };
      const counts = dsrCounts(match);
      if (!input.report) return { kind: "found", counts, reportBytes: null };
      const written = await writeEncryptedFile(
        input.report.out,
        input.report.recipient,
        reportChunks(trx, { orgId: input.orgId, address, now }, match)
      );
      if (written.kind === "exists") return { kind: "exists" };
      return { kind: "found", counts, reportBytes: written.bytes };
    });
  if (result.kind !== "found") return result;

  try {
    await recordAudit(
      db,
      { orgId: input.orgId },
      {
        actor: "cli",
        event: auditEvents.dsrFind,
        data: dsrAuditData(dsrAddressHash(input.credentialsKey, address), result.counts),
        at: now,
      }
    );
  } catch (error) {
    if (input.report) await unlink(input.report.out).catch(() => undefined);
    throw error;
  }
  return result;
}
