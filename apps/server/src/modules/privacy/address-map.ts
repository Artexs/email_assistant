// The registry of the columns that can hold the address of a third party (ticket F106, account data).
//
// One list serves the find (stage 07) and the erase (stage 08), so a column cannot be searched and then skipped when
// the rows are cleaned. A completeness test reads `information_schema` and fails for a candidate column that is in
// neither `DSR_ADDRESS_MAP` nor `NOT_PERSONAL`: a new column that may hold an address needs an owner's decision here.

// How a column is compared with the address:
//   sender      the address of the mail's sender; the mail goes (cascade)
//   recipients  an address list; one element equals the address
//   text        free text; the address anywhere in it (`addressRegex`)
//   json        a jsonb document; the address anywhere in its text form (`addressRegex`)
//   equal       one address; the whole value equals the address
//   list        a row that the operator reads and the owner decides on (a delegate, a rule); never changed
export type AddressRule = "sender" | "recipients" | "text" | "json" | "equal" | "list";

export const DSR_ADDRESS_MAP: Readonly<Record<string, Readonly<Record<string, AddressRule>>>> = {
  emails: {
    from_address: "sender",
    to_addresses: "recipients",
    cc_addresses: "recipients",
    subject: "text",
    body_text: "text",
  },
  email_headers: {
    // The display name can be an address (`"p@x.test" <r@x.test>`), so a kept mail can hold the person's address here.
    from_name: "text",
    reply_to: "recipients",
    return_path: "equal",
  },
  triage_results: {
    reason: "text",
    fields: "json",
  },
  actions: {
    last_error: "text",
    payload: "json",
    provider_result: "json",
  },
  outbox: {
    text: "text",
    view: "json",
  },
  delegations: {
    task_summary: "text",
  },
  delegates: {
    email: "list",
    name: "list",
  },
  sender_rules: {
    pattern: "list",
  },
};

// Tables that hold one mail's data and go with the mail (`emails` cascades to the rest). Every text, array and jsonb
// column of these tables is a candidate column in the completeness test, whatever its name.
export const MESSAGE_TABLES: readonly string[] = [
  "emails",
  "email_headers",
  "triage_results",
  "actions",
  "action_feedback",
  "outbox",
  "delegations",
];

function reasons(columns: readonly string[], reason: string): [string, string][] {
  return columns.map((column) => [column, reason]);
}

// "table.column" → why the column never holds the address of a third party (or why it is not searched).
export const NOT_PERSONAL: Readonly<Record<string, string>> = Object.fromEntries([
  ...reasons(["mailboxes.address"], "own mailbox: a DSR for it is refused (own_address)"),
  ...reasons(["users.email"], "a member: a DSR for it is refused (own_address)"),
  ...reasons(["auth_sessions.ip_address"], "a network address, not a mail address"),
  ...reasons(
    ["action_feedback.kind", "action_feedback.reason", "action_feedback.via"],
    "closed list of codes (CHECK constraint)"
  ),
  ...reasons(
    ["actions.type", "actions.status", "actions.status_reason", "actions.approved_via"],
    "closed list of codes or a code from our own code"
  ),
  ...reasons(["actions.idempotency_key"], "built from ids and hashes, no address"),
  ...reasons(["actions.outgoing_message_id"], "the Message-ID that we make: random part and our own host, no address"),
  ...reasons(["delegations.status", "delegations.status_reason"], "closed list of codes"),
  ...reasons(["delegations.sent_message_id"], "the Message-ID of our own send, no address of a person"),
  ...reasons(
    ["email_headers.auth_results"],
    "cut authentication verdicts (domains and verdicts); a mail that goes is deleted with it"
  ),
  ...reasons(
    ["email_headers.list_unsubscribe", "email_headers.list_id"],
    "address or name of a mailing list, set by the list sender, not of a person"
  ),
  ...reasons(["email_headers.auto_submitted", "email_headers.precedence"], "one header token, no address"),
  ...reasons(["email_headers.attachments"], "file names, types and sizes, no address"),
  ...reasons(["email_headers.links"], "link host names only, no address"),
  ...reasons(
    ["emails.dedup_key", "emails.message_id_header", "emails.in_reply_to", "emails.references_header"],
    "a Message-ID: random part and the host of the sender's system, no address of a person"
  ),
  ...reasons(["emails.thread_key"], "a Message-ID or a mailbox key, no address of a person"),
  ...reasons(["emails.content_hash"], "a hash"),
  ...reasons(["emails.folder", "emails.source_folder"], "IMAP folder name"),
  ...reasons(["emails.status", "emails.skip_reason"], "closed list of codes"),
  ...reasons(
    ["outbox.kind", "outbox.status", "outbox.error_code", "outbox.channel", "outbox.locale", "outbox.detail"],
    "closed list of codes"
  ),
  ...reasons(["outbox.dedup_key"], "built from ids and kinds, no address"),
  ...reasons(["outbox.buttons"], "callback data made of ids and codes, no address"),
  ...reasons(["triage_results.category", "triage_results.reason_code"], "closed list of codes"),
  ...reasons(["triage_results.model", "triage_results.prompt_version"], "model and prompt names"),
]);

const MAX_ADDRESS_LENGTH = 254;

// Trims and lower-cases. Null unless the value is one address: one `@`, a dot after it, at most 254 characters,
// and no whitespace, quote, backslash or angle bracket.
export function normalizeDsrAddress(input: string): string | null {
  const address = input.trim().toLowerCase();
  if (address.length === 0 || address.length > MAX_ADDRESS_LENGTH) return null;
  if (/[\s"\\<>]/u.test(address)) return null;
  const parts = address.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes(".")) return null;
  return address;
}

// The Postgres regular expression for `text` and `json` columns (F106 plan, fact 5). Use it with `~*` here and with
// `regexp_replace(…, 'gi')` in stage 08. `jimbob@x.test` and `bob@x.test.pl` do not match `bob@x.test`; `bob@x.test.`
// (end of a sentence) and `<bob@x.test>` do. The input must be normalized (`normalizeDsrAddress`).
export function addressRegex(address: string): string {
  // `\` before an ASCII punctuation character makes it an ordinary character in a Postgres regex.
  const escaped = address.replace(/[!-/:-@[-`{-~]/gu, "\\$&");
  return `(?<![a-z0-9._%+-])${escaped}(?![a-z0-9-]|\\.[a-z0-9])`;
}
