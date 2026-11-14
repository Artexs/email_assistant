# F106 stage 06 — The DSR address map and the matching

Part of [`../plan.md`](../plan.md). `[risky]` (privacy).

## Step 1 — the map, its completeness test and `matchSubject`

**Goal.** One registry names every column that can hold a third party's address, and one read-only function finds what the organization holds about one address. Stages 07 and 08 build on it.

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
}
export async function matchSubject(db: DbOrTrx, orgId: string, address: string): Promise<DsrMatch>;
```

**Decisions.** D7, D8, D9, D10.

- **Map at `HEAD`.** `sender`: `emails.from_address`. `recipients`: `emails.to_addresses`, `emails.cc_addresses`, `email_headers.reply_to`. `text`: `emails.subject`, `emails.body_text`, `triage_results.reason`, `actions.last_error`, `outbox.text`, `delegations.task_summary`. `json`: `triage_results.fields`, `actions.payload`, `actions.provider_result`, `outbox.view`. `equal`: `email_headers.return_path`. `list`: `delegates.email`, `delegates.name`, `sender_rules.pattern`. Every other candidate column goes to `NOT_PERSONAL` with a reason, for example `mailboxes.address` "the organization's own mailbox", `users.email` "a member, not a third party", `auth_sessions.ip_address` "a member's session", Message-ID and hash columns "no address", `email_headers.from_name` "the sender's name; the row goes with a mail the person sent".
- **Candidate columns:** public columns of type `text`, `character varying`, `ARRAY` or `jsonb` whose name matches `%address%`, `%email%`, `from\_%`, `to\_%` or `%pattern%`, plus every column of these types in a `MESSAGE_TABLES` table.
- **Address:** `normalizeDsrAddress` trims and lower-cases; null unless it has one `@`, a dot after it, at most 254 characters and no whitespace, `"`, `\`, `<` or `>`.
- **Pattern** (plan F5): `(?<![a-z0-9._%+-])` + the address with every regex meta character escaped + `(?![a-z0-9-]|\.[a-z0-9])`, used with `~*` (and with `regexp_replace(…, 'gi')` in stage 08). `sender`, `recipients`, `equal` and `list` compare `lower(value) = address` (arrays: any element).
- **Mail that goes (D9):** a mail of mailbox M goes when `lower(from_address)` is the address, or the address is in `to ∪ cc` and every other address of `{from} ∪ to ∪ cc` is M's own address. Every copy (`#n` key) follows the same rule.
- **Mentions:** rows that do not go with a mail (directly or by cascade from `emails`) and match by a `recipients`, `text`, `json` or `equal` column.
- **Open actions:** actions whose status is not `applied`, `rejected`, `expired`, `undone`, `logged` or `failed`, and that are `applying` on a mail that goes, or are on a kept mail with a `payload` that matches.
- **`ownAddress`:** the address is a mailbox address of the organization or the e-mail of one of its members (then the other fields are empty).
- Every query filters by `org_id`. `matchSubject` writes nothing.

**Test** (integration, `privacy-dsr-match.test.ts`; person `p@x.test`, mailbox `own@x.test`, member `owner@x.test`):

1. Completeness: every candidate column is in `DSR_ADDRESS_MAP` or `NOT_PERSONAL`; every entry of both is a real column; no column is in both.
2. From `P@X.test` → goes; from `own@x.test` to `[own@x.test, p@x.test]` → goes; from `r@x.test` to `[p@x.test, q@x.test]` → kept, mention `emails.to_addresses`; cc `[jimbob@x.test]` → no match.
3. A kept mail with body `"write p@x.test."` → mention `emails.body_text`; body `"p@x.test.pl"` → none; a triage `fields` value `{"to":["p@x.test"]}` → mention `triage_results.fields`.
4. A kept mail's `awaiting_approval` send with `p@x.test` in the payload → `openActions` 1; the same in status `applied` → 0 open, 1 mention `actions.payload`.
5. A delegate with e-mail `p@x.test` and a blocklist rule `p@x.test` → listed 1 each; a rule `@x.test` → not listed.
6. `own@x.test` and `owner@x.test` → `ownAddress: true`.
7. `normalizeDsrAddress`: `" P@X.Test "` → `"p@x.test"`; `"p@x"`, `"a b@x.test"`, `"<p@x.test>"` → null.
8. A match in organization B never shows in A's result.
9. Row counts of every table are the same before and after.

**Check.** `bun test apps/server/test/integration/privacy-dsr-match.test.ts`.

**Done when.** Tests 1–9 pass and the plan Proof (server chain) prints `PROOF_OK`.

**Out of scope.** The CLI, the audit row and the report (stage 07); erase (stage 08).
