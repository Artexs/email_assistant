// The tables of the demo seed file, and how each one is cut, linked and re-keyed.
//
// The columns of each table are the columns of `EXPORT_MAP` of the privacy module (the same map the account export uses):
// an `export: false` table is never listed here, and a column in `excluded` is never read. There is no second list of
// secret columns. The integration test `lab-demo-seed-export` compares this file with `information_schema`: a new column or a
// new foreign key on one of these tables fails there until someone decides here what the seed does with it.
import { EXPORT_MAP } from "../../privacy";

// In insert order: a table comes after every table it points to.
export const DEMO_TABLES = [
  "organizations",
  "mailboxes",
  "mailbox_settings",
  "sender_rules",
  "delegates",
  "emails",
  "email_headers",
  "triage_results",
  "triage_feedback",
  "actions",
  "delegations",
  "outbox",
  "audit_log",
] as const;

export type DemoTable = (typeof DEMO_TABLES)[number];

export type DemoRow = Record<string, unknown>;

export interface TableSpec {
  /** The column that holds the row's own UUID; the import gives every such row a new one. */
  id?: string;
  /** The column that the table is sorted by (numeric for a bigint). */
  sort: string;
  numericSort?: boolean;
  /** The column that holds the creation time, cut at 00:00 Warsaw after the run day. Undefined: the table is not cut. */
  time?: string;
  /** Foreign key column to the table of the file (a nullable column may hold null). */
  refs: Readonly<Record<string, DemoTable>>;
  /** A reference that becomes null when its row is cut away (the foreign key is `ON DELETE SET NULL`). */
  softRefs?: readonly string[];
  /** Foreign key to the same table: the parent row comes first in the import. */
  selfRefs?: readonly string[];
  /** A column that holds a user id: the import writes the id of the new owner. */
  userRefs?: readonly string[];
  /** `json` and `jsonb` columns: an id inside them is mapped, as an id in a text key column is. */
  json: readonly string[];
  /** Text columns that can hold an id of a row (`ap:<id>`, a dedup key): the import maps each id in them. */
  idText?: readonly string[];
  /** A row with a value in one of these columns is not exported: the parent table (`digests`, `open_loops`) is not in the file. */
  unexportable?: readonly string[];
  /** Columns of the file that the import does not insert (the database makes them). */
  dropOnImport?: readonly string[];
}

export const TABLE_SPECS: Readonly<Record<DemoTable, TableSpec>> = {
  organizations: { id: "id", sort: "id", refs: {}, json: [] },
  mailboxes: { id: "id", sort: "id", time: "created_at", refs: {}, json: ["capabilities", "folder_map"] },
  mailbox_settings: {
    sort: "mailbox_id",
    refs: { mailbox_id: "mailboxes" },
    json: ["tool_switches", "category_policy", "urgency_profile"],
  },
  sender_rules: { id: "id", sort: "id", time: "created_at", refs: { mailbox_id: "mailboxes" }, json: [] },
  delegates: { id: "id", sort: "id", time: "created_at", refs: {}, json: [] },
  emails: { id: "id", sort: "id", time: "created_at", refs: { mailbox_id: "mailboxes" }, json: [] },
  email_headers: {
    sort: "email_id",
    time: "captured_at",
    refs: { email_id: "emails" },
    json: ["attachments", "links", "dkim_signatures"],
  },
  triage_results: {
    id: "id",
    sort: "id",
    time: "created_at",
    refs: { email_id: "emails" },
    json: ["fields"],
  },
  triage_feedback: {
    id: "id",
    sort: "id",
    time: "created_at",
    refs: { email_id: "emails" },
    userRefs: ["user_id"],
    json: [],
  },
  actions: {
    id: "id",
    sort: "id",
    time: "created_at",
    refs: { email_id: "emails" },
    unexportable: ["loop_id"],
    selfRefs: ["depends_on_action_id", "reverses_action_id", "supersedes_action_id"],
    userRefs: ["approved_by"],
    json: ["payload", "provider_result"],
    idText: ["idempotency_key"],
  },
  delegations: {
    id: "id",
    sort: "id",
    time: "created_at",
    refs: {
      mailbox_id: "mailboxes",
      email_id: "emails",
      delegate_id: "delegates",
      draft_action_id: "actions",
      send_action_id: "actions",
      answered_email_id: "emails",
    },
    softRefs: ["answered_email_id"],
    json: [],
  },
  outbox: {
    id: "id",
    sort: "id",
    time: "created_at",
    refs: { email_id: "emails", mailbox_id: "mailboxes" },
    selfRefs: ["edit_of_outbox_id"],
    userRefs: ["user_id"],
    json: ["buttons", "view"],
    idText: ["dedup_key"],
    // A push row points at a device (`push_subscriptions`), which is not in the file.
    unexportable: ["digest_id", "loop_id", "push_subscription_id"],
  },
  audit_log: {
    sort: "id",
    numericSort: true,
    time: "created_at",
    refs: { email_id: "emails", action_id: "actions" },
    json: ["data"],
    idText: ["actor"],
    dropOnImport: ["id"],
  },
};

/** The columns of a table in the file: the `EXPORT_MAP` columns, so an `excluded` or secret column never appears. */
export function demoColumns(table: DemoTable): readonly string[] {
  const entry = EXPORT_MAP[table];
  if (entry === undefined || !entry.export || entry.via !== "org_id") {
    throw new Error(`demo seed: ${table} is not an exported organization table`);
  }
  return entry.columns;
}

/** The column that ties a row to its organization (the `organizations` row is tied by its `id`). */
export const orgColumnOf = (table: DemoTable): string => (table === "organizations" ? "id" : "org_id");
