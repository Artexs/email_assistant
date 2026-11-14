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
    // The verdict header can name the sender's address (`smtp.mailfrom=p@x.test`); the capture keeps up to 1000 characters.
    auth_results: "text",
    // File names: a person can name a file after an address (`p@x.test.vcf`).
    attachments: "json",
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
    ["email_headers.list_unsubscribe"],
    "the unsubscribe link or mailto of a mailing list; a mailto holds the subscriber, normally the organization's own mailbox"
  ),
  ...reasons(["email_headers.list_id"], "the name of a mailing list, set by the list sender"),
  ...reasons(["email_headers.auto_submitted", "email_headers.precedence"], "one header token, no address"),
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
  ...reasons(["audit_log.actor", "audit_log.event", "audit_log.reason_code"], "closed list of codes or an id"),
  ...reasons(
    ["audit_log.data"],
    "flat ids, codes and numbers only (`AuditData`); never mail text or an address, and a DSR audit row holds a hash"
  ),
  ...reasons(["delegates.competence_tags"], "short competence labels that the owner types; not a contact field"),
  ...reasons(["mailboxes.capabilities", "mailboxes.folder_map"], "server capability flags and folder names"),
  ...reasons(
    ["mailboxes.imap_host", "mailboxes.smtp_host", "mailboxes.protocol", "mailboxes.smtp_security", "mailboxes.status"],
    "host names and codes of our own mailbox setup"
  ),
  ...reasons(
    ["mailbox_settings.category_policy", "mailbox_settings.tool_switches"],
    "closed keys of the organization's settings"
  ),
  ...reasons(["mailbox_settings.mode"], "closed list of codes"),
  ...reasons(
    ["organizations.name", "organizations.timezone", "organizations.plan"],
    "name and codes of our own customer"
  ),
  ...reasons(
    ["organizations.style_text"],
    "the owner's text about their own writing style; an organization setting, not mail data (open: an address typed there stays)"
  ),
  ...reasons(["sender_rules.kind"], "closed list of codes"),
]);

// Tables whose text, array and jsonb columns hold no address of a third party. The completeness test accepts every
// column of these tables without an entry above. A table that is not here needs every such column in the map or in
// `NOT_PERSONAL`.
export const NO_PERSONAL_TABLES: Readonly<Record<string, string>> = {
  chat_links: "the channel code",
  chat_link_tokens: "the hash of a link token",
  digests: "the slot key (a date and a code)",
  dsr_tombstones: "the hash of a Message-ID",
  email_flags: "a check code",
  mailbox_credentials: "an encrypted secret and its kind",
  mailbox_folders: "folder key, path and role of our own mailbox",
  memberships: "role and digest times of a member",
  org_features: "a flag name and a code",
  triage_feedback: "source, verdict and category codes",
};

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

// Characters that can stand next to an address inside one larger word: the RFC 5322 `atext` characters and the dot of
// a local part, and letters (ASCII, then Latin, Greek and Cyrillic ranges that hold the non-ASCII letters; `[:alpha:]`
// depends on the database locale, the ranges do not). The look-behind rejects the address inside a longer local part
// (`o'p@x.test`, `=p@x.test`, `x/p@x.test`, `łp@x.test`). Widened after the Opus review of stage 06.
const ATEXT = "a-z0-9._%+!#$&'*/=?^`{|}~-";
const LETTERS = "[:alpha:]\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u024f\\u0370-\\u052f";

// The Postgres regular expression for `text` and `json` columns (F106 plan, fact 5). Use it with `~*` here and with
// `regexp_replace(…, 'gi')` in stage 08. `jimbob@x.test`, `o'bob@x.test`, `bob@x.test.pl`, `bob@x.test_x` and
// `bob@x.testé` do not match `bob@x.test`; `bob@x.test.` (end of a sentence), `<bob@x.test>` and `"bob@x.test"` do.
// The input must be normalized (`normalizeDsrAddress`).
export function addressRegex(address: string): string {
  // `\` before an ASCII punctuation character makes it an ordinary character in a Postgres regex.
  const escaped = address.replace(/[!-/:-@[-`{-~]/gu, "\\$&");
  return `(?<![${LETTERS}${ATEXT}])${escaped}(?![a-z0-9_${LETTERS}-]|\\.[a-z0-9${LETTERS}])`;
}
