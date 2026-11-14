# F106 stage 06 — The DSR address map and the matching

Part of [`../plan.md`](../plan.md). `[risky]` (privacy).

## Step 1 — the map, its completeness test and `matchSubject`

**Goal.** A registry of the columns that can hold a third party's address, and a read-only match of one address.

**Files.** `modules/privacy/address-map.ts`, `modules/privacy/dsr-match.ts`; tests.

**Interfaces.**

```ts
export type AddressRule = "sender" | "recipients" | "text" | "json" | "equal" | "list";
export const DSR_ADDRESS_MAP: Readonly<Record<string, Readonly<Record<string, AddressRule>>>>;
export const NOT_PERSONAL: Readonly<Record<string, string>>; // "table.column" → reason
export const MESSAGE_TABLES: readonly string[]; // emails, email_headers, triage_results, actions, action_feedback, outbox, delegations
export function normalizeDsrAddress(input: string): string | null;
export function addressRegex(address: string): string;
export interface DsrMatch {
  ownAddress: boolean;
  mails: { id: string; dedupKey: string }[];
  mentions: Record<string, string[]>; // "table.column" → row ids
  listed: { delegates: string[]; senderRules: string[] };
  openActions: string[];
  chainActions: string[];
}
export async function matchSubject(db: DbOrTrx, orgId: string, address: string): Promise<DsrMatch>;
```

**Decisions.** D7–D10.

- **Map at `HEAD`.** `sender`: `emails.from_address`. `recipients`: `emails.to_addresses`, `emails.cc_addresses`, `email_headers.reply_to`. `text`: `email_headers.from_name` (a display name can hold an address; owner decision 2026-11-14), `emails.subject`, `emails.body_text`, `triage_results.reason`, `actions.last_error`, `outbox.text`, `delegations.task_summary`. `json`: `triage_results.fields`, `actions.payload`, `actions.provider_result`, `outbox.view`. `equal`: `email_headers.return_path`. `list`: `delegates.email`, `delegates.name`, `sender_rules.pattern`. Every other candidate column goes to `NOT_PERSONAL` with a reason (for example `mailboxes.address` "own mailbox", `users.email` "a member", Message-ID and hash columns "no address").
- **Candidate columns:** public `text`, `character varying`, `ARRAY` or `jsonb` columns named like `%address%`, `%email%`, `from\_%`, `to\_%`, `%pattern%`, and all such columns of `MESSAGE_TABLES`.
- **Address:** `normalizeDsrAddress` trims and lower-cases; null unless it has one `@`, a dot after it, at most 254 characters and no whitespace, `"`, `\`, `<` or `>`.
- **Pattern** (plan F5): `(?<![a-z0-9._%+-])` + the escaped address + `(?![a-z0-9-]|\.[a-z0-9])`, with `~*` here and `regexp_replace(…, 'gi')` in stage 08. Other rules compare `lower(value) = address` (arrays: any element).
- **Mail that goes (D9):** a mail goes when `lower(from_address)` is the address, or its `email_headers.reply_to` is exactly the address (a contact form, review 1 N4), or the address is in `to ∪ cc` and every other address of `{from} ∪ to ∪ cc` is a mailbox address of the organization. It reads only the mail and the organization's addresses, so one mail in two mailboxes gets one answer (per-organization tombstones, review 1 N5).
- **Mentions:** rows that do not go with a mail (directly or by cascade) and match by a `recipients`, `text`, `json` or `equal` column.
- **Open actions** (status not `applied`, `rejected`, `expired`, `undone`, `logged`, `failed`): on a mail that goes, an `applying` action or a `send` or `create_draft`; on a kept mail, one whose `payload` matches. So no pending approval request names a mail that goes.
- **Chain actions:** actions of kept mails whose `depends_on_action_id` or `reverses_action_id` points at an action of a mail that goes (these FKs have no cascade).
- **`ownAddress`:** a mailbox address of the organization or a member's e-mail (the other fields stay empty).
- Every query filters by `org_id`. `matchSubject` writes nothing.

**Test** (integration; person `p@x.test`, mailboxes `own@x.test` and `own2@x.test`, member `owner@x.test`):

1. Completeness: each candidate column is in exactly one of `DSR_ADDRESS_MAP` and `NOT_PERSONAL`; each entry is a real column.
2. From `P@X.test` → goes; from `own@x.test` to `[own2@x.test, p@x.test]` → goes; from `noreply@x.test` with Reply-To `[p@x.test]` → goes; from `r@x.test` to `[p@x.test, q@x.test]` → kept, mention `emails.to_addresses`; cc `[jimbob@x.test]` → no match. The same mail stored in both mailboxes gets the same answer.
3. Kept mail with `from_name` `"p@x.test"` → mention `email_headers.from_name`; `from_name` `"Pat Smith"` → none. Kept mail body `"write p@x.test."` → mention `emails.body_text`; `"p@x.test.pl"` → none; triage `fields` `{"to":["p@x.test"]}` → mention `triage_results.fields`.
4. A kept mail's `awaiting_approval` send with `p@x.test` in the payload → 1 open action; status `applied` → 0 open, 1 mention `actions.payload`. A `ready` move on a mail that goes → not open; an `awaiting_approval` send there → open. A kept mail's action with `depends_on_action_id` on an action of a mail that goes → 1 chain action.
5. Delegate `p@x.test` and blocklist rule `p@x.test` → listed 1 each; rule `@x.test` → not listed.
6. `own@x.test`, `owner@x.test` → `ownAddress`.
7. `normalizeDsrAddress(" P@X.Test ")` → `"p@x.test"`; `"p@x"`, `"a b@x.test"`, `"<p@x.test>"` → null.
8. B's rows never show in A's match.
9. No row changes.

**Done when.** Tests 1–9 pass and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** CLI, audit and report (stage 07); erase (stages 08, 09).
