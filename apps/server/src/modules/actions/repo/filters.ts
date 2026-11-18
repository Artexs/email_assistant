import { sql, type Expression, type SqlBool } from "kysely";

import { mailKindFilter, type TestMailRule } from "../../mail";

// `mailbox` gates the mailbox changes and the drafts: none = save_summary only; synthetic = save_summary and synthetic mail;
// all = everything. `send` gates the sends (D16): none = no send; self = only to the listed (lower-case) addresses; all = every send.
export type MailboxClaimFilter = { kind: "none" } | { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };
export type SendClaimFilter = { kind: "none" } | { kind: "self"; addresses: string[] } | { kind: "all" };
export interface ClaimFilter {
  mailbox: MailboxClaimFilter;
  send: SendClaimFilter;
  // `off`: the flag `reply_drafts` of the organization is off, so an `approved` reply send is not claimed (it waits and ends as
  // `held_timeout`). Absent: replies are claimed as every other send. The committer sets it on every run.
  replies?: "off";
}
export const sqlTrue = sql<SqlBool>`true`;
const sqlFalse = sql<SqlBool>`false`;
export function mailboxFilterExpr(filter: MailboxClaimFilter): Expression<SqlBool> {
  if (filter.kind === "none") return sqlFalse;
  if (filter.kind === "synthetic") return mailKindFilter("synthetic", filter.testMail);
  return sqlTrue;
}
// `payload.to` and `payload.cc` are JSON arrays (D2). Every address of both must be listed (a follow-up has a Cc). The CASE keeps a
// malformed payload from raising: it is simply not admitted. A missing `cc` has no address; a `cc` that is not an array is refused.
export function sendFilterExpr(filter: SendClaimFilter): Expression<SqlBool> {
  if (filter.kind === "none") return sqlFalse;
  if (filter.kind === "all") return sqlTrue;
  const addresses = filter.addresses.map((address) => address.toLowerCase());
  return sql<SqlBool>`(CASE WHEN jsonb_typeof(actions.payload->'to') = 'array'
      AND (actions.payload->'cc' IS NULL OR jsonb_typeof(actions.payload->'cc') = 'array') THEN
      jsonb_array_length(actions.payload->'to') > 0 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(actions.payload->'to') r WHERE lower(r) <> ALL(${addresses}::text[])
      ) AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(coalesce(actions.payload->'cc', '[]'::jsonb)) r
        WHERE lower(r) <> ALL(${addresses}::text[])
      )
    ELSE false END)`;
}
