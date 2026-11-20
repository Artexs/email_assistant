import { sql, type Expression, type RawBuilder } from "kysely";

export { addressRegex, normalizeDsrAddress } from "./address-regex";

// The registry of the columns that can hold the address of a third party (account data).
//
// One list serves the find and the erase, so a column cannot be searched and then skipped when
// the rows are cleaned. A completeness test reads `information_schema` and fails for a candidate column that is in
// neither `DSR_ADDRESS_MAP` nor `NOT_PERSONAL`: a new column that may hold an address needs an owner's decision here.

// How a column is compared with the address:
//   sender      the address of the mail's sender; the mail goes (cascade)
//   recipients  an address list; one element equals the address
//   text        free text; the address anywhere in it (`addressRegex`)
//   json        a jsonb document; the address anywhere in its text form (`addressRegex`)
//   equal       one address; the whole value equals the address
//   list        a row that the operator reads and the owner decides on (a delegate, a rule); never changed
//   delete      one address; the whole value equals the address, and the erase deletes the row (not a cleaned value: a
//               NOT NULL value that becomes `''` would hit a unique key on the second erase)
export type AddressRule = "sender" | "recipients" | "text" | "json" | "equal" | "list" | "delete";

export const DSR_ADDRESS_MAP: Readonly<Record<string, Readonly<Record<string, AddressRule>>>> = {
  emails: {
    from_address: "sender",
    to_addresses: "recipients",
    cc_addresses: "recipients",
    subject: "text",
    body_text: "text",
  },
  // Mail that the user sent: no incoming mail, so no mail filter in the find. A sent mail whose other parties are own mailboxes goes with a tombstone (see `findSentMails`); the others lose the address.
  sent_emails: {
    from_address: "equal",
    to_addresses: "recipients",
    cc_addresses: "recipients",
    subject: "text",
    body_text: "text",
  },
  // A loop copies recipients, the first recipient and a short ask or promise from sent mail. No mail filter: a loop is
  // never a row of a mail that goes (its Sent row goes, the loop stays). The erase also clears `text` of a loop that
  // names the person in `counterpart`, `to_addresses` or `cc_addresses` (see `clearLoopTextsOfPerson` in erase.ts).
  open_loops: {
    counterpart: "equal",
    to_addresses: "recipients",
    cc_addresses: "recipients",
    subject: "text",
    text: "text",
  },
  // The instruction of a reply request is the user's own text and can name a person ("tell jan@firma.pl we agree"); a
  // sample draft is the AI's body for a mail. A request of a mail that goes cascades with the mail; the others are mentions.
  reply_requests: {
    instruction: "text",
    sample_body: "text",
  },
  // The name, the signature and the writing style of a mailbox: user text, no mail filter. A signature can name a
  // colleague's address; the erase replaces it.
  mailbox_profiles: {
    display_name: "text",
    signature: "text",
    writing_style: "text",
  },
  // The sender that the user asked to unsubscribe from: a third-party address. The erase of the sender deletes the
  // row. `sender_domain` is its domain part (no address): it goes with the row, see `NOT_PERSONAL`.
  unsubscribe_requests: {
    sender_lower: "delete",
  },
  // The address or `@domain` of an OPEN rule suggestion (sender context): a third-party address. The erase of the address deletes the row;
  // a domain pattern never equals one address, so it stays (the person's profile rows go by their hash, `deleteSenderContextRowsOf` in `modules/contacts/privacy.ts`).
  sender_suggestions: {
    pattern: "delete",
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

// Tables that hold one mail's data and go with the mail (`emails` cascades to the rest); the `actions` and `outbox` rows
// of a loop go with the loop (`open_loops` cascades to them). A reply request goes with its mail too, but it is not in
// this list: its two text columns are in `DSR_ADDRESS_MAP` and the rest is codes. Every text, array and jsonb
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
  ...reasons(["delegations.source"], "closed list of codes (CHECK constraint)"),
  ...reasons(
    ["open_loops.kind", "open_loops.status", "open_loops.close_reason", "open_loops.language", "open_loops.due_source"],
    "closed list of codes (CHECK constraint)"
  ),
  ...reasons(
    ["open_loops.thread_key", "open_loops.message_id", "open_loops.references_ids"],
    "a Message-ID: random part and the host of the sender's system, no address of a person"
  ),
  ...reasons(
    ["reply_requests.trigger", "reply_requests.status", "reply_requests.reason_code"],
    "closed list of codes (CHECK constraint), or a reason code of our own drafter"
  ),
  ...reasons(
    ["reply_requests.thread_key"],
    "a Message-ID: random part and the host of the sender's system, no address of a person"
  ),
  ...reasons(
    ["reply_requests.folder"],
    "the name of a folder of the mailbox (INBOX, a folder the user made), no address of a person"
  ),
  ...reasons(
    ["sent_analyses.status", "sent_analyses.skip_reason", "sent_analyses.prompt_version"],
    "closed list of codes, or the name of a prompt version"
  ),
  ...reasons(["delegations.status", "delegations.status_reason"], "closed list of codes"),
  ...reasons(
    [
      "history_checks.status",
      "history_checks.reason",
      "history_checks.no_result_reason",
      "history_check_items.category",
      "history_check_items.reason_code",
      "history_check_items.source",
      "autonomy_trips.category",
      "autonomy_trips.reason",
      "memberships.report_channel",
    ],
    "closed list of codes (CHECK constraint), or a reason code of our own classifier"
  ),
  ...reasons(
    ["history_checks.key"],
    "the evidence key of a check: provider, model, prompt version and the host of an own endpoint; no address of a person"
  ),
  ...reasons(["history_checks.result", "autonomy_trips.counts"], "counts and shares per category; no text"),
  ...reasons(["memberships.quiet_start", "memberships.quiet_end"], "a time of day (HH:MM, CHECK constraint)"),
  ...reasons(["delegations.sent_message_id"], "the Message-ID of our own send, no address of a person"),
  ...reasons(
    ["email_headers.list_unsubscribe"],
    "the unsubscribe link or mailto of a mailing list; a mailto holds the subscriber, normally the organization's own mailbox"
  ),
  ...reasons(
    ["unsubscribe_requests.sender_domain"],
    "the domain part of `sender_lower`, no local part: no address of a person; the row goes with the erase of the sender"
  ),
  ...reasons(
    ["unsubscribe_requests.method", "unsubscribe_requests.status", "unsubscribe_requests.code"],
    "closed list of codes (CHECK constraint); `code` is a short result code, never a URL"
  ),
  ...reasons(
    ["sender_profiles.key_hash", "sender_suggestions.key_hash"],
    "keyed hash (HMAC-SHA256, 64 hex characters, CHECK constraint) of the address; the erase finds the rows by the hash of the address"
  ),
  ...reasons(
    ["sender_profiles.by_category", "sender_profiles.corrections"],
    "category names with counts; the CHECK constraint refuses any other key"
  ),
  ...reasons(["sender_profiles.bulk_signals", "sender_profiles.relation"], "closed list of codes (CHECK constraint)"),
  ...reasons(
    ["sender_suggestions.scope", "sender_suggestions.kind", "sender_suggestions.status"],
    "closed list of codes (CHECK constraint)"
  ),
  ...reasons(["sender_suggestions.reason"], "counts under fixed keys (CHECK constraint); no text and no address"),
  ...reasons(["email_headers.list_id"], "the name of a mailing list, set by the list sender"),
  ...reasons(["email_headers.auto_submitted", "email_headers.precedence"], "one header token, no address"),
  ...reasons(["email_headers.links"], "link host names only, no address"),
  ...reasons(
    ["email_headers.dkim_signatures"],
    "the signing domain and the signed header names of each DKIM-Signature header (a domain is a domain, a header name is a token); never the signature value; no address"
  ),
  ...reasons(
    ["emails.dedup_key", "emails.message_id_header", "emails.in_reply_to", "emails.references_header"],
    "a Message-ID: random part and the host of the sender's system, no address of a person"
  ),
  ...reasons(["emails.from_address_lower"], "generated copy of emails.from_address; goes with the row"),
  ...reasons(["emails.thread_key"], "a Message-ID or a mailbox key, no address of a person"),
  ...reasons(
    [
      "sent_emails.dedup_key",
      "sent_emails.message_id",
      "sent_emails.parent_message_id",
      "sent_emails.references_ids",
      "sent_emails.thread_key",
    ],
    "a Message-ID: random part and the host of the sender's system, no address of a person"
  ),
  ...reasons(["sent_emails.path"], "IMAP folder name"),
  ...reasons(["sent_emails.origin", "sent_emails.content"], "closed list of codes (CHECK constraint)"),
  ...reasons(["sent_emails.auto_submitted", "sent_emails.precedence"], "one header token, no address"),
  ...reasons(["sent_emails.list_id"], "the name of a mailing list, set by the list sender"),
  ...reasons(["emails.content_hash"], "a hash"),
  ...reasons(["emails.folder", "emails.source_folder"], "IMAP folder name"),
  ...reasons(["emails.status", "emails.skip_reason"], "closed list of codes"),
  ...reasons(
    ["outbox.kind", "outbox.status", "outbox.error_code", "outbox.channel", "outbox.locale", "outbox.detail"],
    "closed list of codes"
  ),
  ...reasons(["outbox.dedup_key"], "built from ids and kinds, no address"),
  ...reasons(["outbox.buttons"], "callback data made of ids and codes, no address"),
  ...reasons(
    ["triage_results.category", "triage_results.reason_code", "triage_results.suspicious_reasons"],
    "closed list of codes (CHECK constraint)"
  ),
  ...reasons(["triage_results.model", "triage_results.prompt_version"], "model and prompt names"),
  ...reasons(["audit_log.actor", "audit_log.event", "audit_log.reason_code"], "closed list of codes or an id"),
  ...reasons(
    ["audit_log.data"],
    "flat ids, codes and numbers only (`AuditData`); never mail text or an address, and a DSR audit row holds a hash"
  ),
  ...reasons(["delegates.competence_tags"], "short competence labels that the owner types; not a contact field"),
  ...reasons(["mailboxes.capabilities", "mailboxes.folder_map"], "server capability flags and folder names"),
  ...reasons(
    [
      "mailboxes.imap_host",
      "mailboxes.smtp_host",
      "mailboxes.protocol",
      "mailboxes.smtp_security",
      "mailboxes.status",
      "mailboxes.send_via",
      "mailboxes.oauth_provider",
      "mailboxes.auth_reason",
    ],
    "host names and codes of our own mailbox setup"
  ),
  ...reasons(
    ["mailbox_settings.category_policy", "mailbox_settings.tool_switches"],
    "closed keys of the organization's settings"
  ),
  ...reasons(["mailbox_settings.mode"], "closed list of codes"),
  ...reasons(
    ["mailbox_settings.urgency_profile"],
    "the owner's own topics, keywords and deadlines; an organization setting, not mail data (open: an address typed there stays)"
  ),
  ...reasons(
    ["organizations.name", "organizations.timezone", "organizations.plan"],
    "name and codes of our own customer"
  ),
  ...reasons(
    ["organizations.style_text"],
    "emptied by a migration and no longer read or written; a later migration drops the column"
  ),
  ...reasons(["sender_rules.kind"], "closed list of codes"),
  ...reasons(
    ["sso_providers.provider_id", "sso_providers.domain_proof", "sso_providers.saml_config"],
    "the organization id as text, a closed list of codes, and a column that stays NULL"
  ),
  ...reasons(
    ["sso_providers.issuer", "sso_providers.domain"],
    "the URL and the mail domain of the organization's own IdP setup, no address of a person"
  ),
  ...reasons(
    ["sso_providers.oidc_config"],
    "the IdP configuration of the organization's own setup: endpoints, client id and client secret, no third-party address"
  ),
  ...reasons(
    ["push_subscriptions.secret", "push_subscriptions.endpoint_hash"],
    "the encrypted push endpoint and keys of a device (a ciphertext), and the SHA-256 hex of the endpoint; no mail address"
  ),
  ...reasons(
    ["push_subscriptions.device_label"],
    "the name of the member's own device (at most 60 characters, set by the panel from the browser); no address of a third party"
  ),
  ...reasons(["push_subscriptions.last_error_code"], "a short result code (CHECK constraint), never a URL"),
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
  mailbox_oauth_states: "a provider code, the hash of a sign-in state and an encrypted verifier",
  mailbox_sent_sync: "folder path, a cursor and codes of the sent-mail sync",
  memberships: "role and digest times of a member",
  ops_alerts: "numbers only: a kind code and numeric facts, no organization",
  org_features: "a flag name and a code",
  triage_feedback: "source, verdict and category codes",
};

// The test "the text `ref` holds the address" for a pattern of `addressRegex`. Find, scrub, the open-action test and the
// post-erase check all run a pattern through this function and `replaceAddress`, so none of them can drift to a
// case-insensitive match. `ref` is a text expression (`${column}::text` for a jsonb column).
export function matchesAddress(ref: Expression<unknown>, pattern: string): RawBuilder<boolean> {
  return sql<boolean>`${ref} ~ ${pattern}`;
}

// The text `ref` with every match of the pattern replaced by `replacement`.
export function replaceAddress(ref: Expression<unknown>, pattern: string, replacement: string): RawBuilder<string> {
  return sql<string>`regexp_replace(${ref}, ${pattern}, ${replacement}, 'g')`;
}
