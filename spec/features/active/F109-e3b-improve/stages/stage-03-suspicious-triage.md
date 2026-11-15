# F109 stage 03 — Rules in triage, no delegation draft for flagged mail

Part of [`../plan.md`](../plan.md). Decisions P1, P8, D2, D4, D5, D6. Needs stages 01 and 02. Review before the land.

## Step 1 — Known-sender context

**Goal.** One reader gives the `assessSuspicious` context of one mailbox, once per mailbox batch.

**Files.** New `apps/server/src/modules/triage/suspicious-context.ts`; config key `MAIL_TRUSTED_AUTHSERV_IDS` (comma list, empty default, lower case) in `platform/config.ts` and `.env.example`.

**Interface.** `loadSuspiciousContext(db, ctx, mailbox): Promise<SuspiciousContext>` with `isKnown(address): boolean`, `knownDomains`, `protectedNames`, `trustedAuthservIds`.

**Decisions (D4).**

- Known addresses: the organization's mailbox addresses, active delegates, exact-address `whitelist` and `vip` rules (mailbox and organization), and frequent senders: an address with at least 3 mails in this mailbox in the last 90 days that each have `suspicious_reasons = '{}'` and a newest category other than `spam` (review N1, N15: flagged mail never makes its sender known).
- Known by domain: the domains of the organization's mailbox addresses, delegates and domain rules (`@corp.test`), except `freeMailDomains` (stage 01).
- `knownDomains`: the registrable domains of the known addresses and domain rules, but not of frequent senders (a frequent sender's domain never silences `lookalike_domain` for others).
- `protectedNames`: delegate names, organization member names, and the newest `email_headers.from_name` of each exact `vip` address in the last 90 days (review N16: CEO-fraud names).
- Accepted limit (stage 16 writes it): mail that forges an own address or own domain counts as known; only `auth_fail` catches it.
- `trustedAuthservIds`: the registrable domain of the mailbox IMAP host, plus `MAIL_TRUSTED_AUTHSERV_IDS` (D2).

## Step 2 — Reasons on every triage result

**Goal.** Each `triage_results` row of the classify or blocklist path carries `suspicious_reasons`, computed before the LLM call (stages 10 and 14 read them).

**Decisions.**

- Read the mail's `email_headers` row with the mail. No row (old mail, failed capture) or cleared texts → `fromName` null, empty lists, `authResults` null: only `lookalike_domain` can fire.
- `isList` = `list_id` or `list_unsubscribe` set. Attachments: all captured entries (inline too).
- Skipped mail (`too_old`, `suspended_backlog`, `body_expired`) gets no row and no reasons, as today.
- The `email.triaged` audit row adds `suspicious` = the code list. A log line may carry the count, never a host, name or address.

## Step 3 — Flagged delegation mail plans nothing

**Goal.** With the flag `suspicious_mail` on, a flagged mail never gets a delegation draft.

**Files.** The flag in `packages/core/src/features.ts` (`suspicious_mail`, default off, epic `E3b`, remove-by `2027-03-01`, description "Suspicious mail gets a warning and no delegation draft."). The service, before `planActions`.

**Decisions (D6).**

- Flag on and reasons not empty and final category `delegation` → no delegation input, an empty plan, no `delegations` row. The category stays `delegation`; the mail stays in INBOX.
- Other categories keep their plan (a flagged `urgent` mail keeps its notice; warning: stage 04).
- Flag off → reasons are stored, the plan is unchanged.
- Whitelist and VIP keep their allowed categories.

**Test (integration, fake LLM, fixed values).**

1. Sender `billing@paliwa-fiota.test`, delegate domain `paliwa-flota.test`, answer `delegation`, flag off → `{lookalike_domain}`, draft and row as today.
2. Same with flag on → category `delegation`, no actions, no `delegations` row, mail in INBOX.
3. Whitelisted sender, attachment `run.exe`, flag on, fake answer `urgent` → reasons `{risky_attachment}`, urgent plan unchanged.
4. Mail without an `email_headers` row from an unknown sender on a known-domain look-alike → `{lookalike_domain}`; from a plain unknown domain → `{}`.
5. Blocklisted sender with a `Reply-To` on another domain → spam, `{reply_to_mismatch}`, no LLM call.
6. Sender with 3 earlier unflagged `info` mails and a `Reply-To` mismatch → `{}` (known). 3 `spam` then 1 `info` → `{reply_to_mismatch}`. 3 earlier `info` mails each with `{lookalike_domain}` → the 4th still `{lookalike_domain}`.
7. Mailbox IMAP host `imap.corp.test`, header `mx.corp.test; dmarc=fail` → `{auth_fail}`; header `evil.test; dmarc=fail` → `{}`; with `MAIL_TRUSTED_AUTHSERV_IDS=evil.test` → `{auth_fail}`.
8. Sender `x@gmai1.com` with known `a@gmail.com` → `{lookalike_domain}`; sender `new@gmail.com` → not known, `{}`.
9. Org B rules and delegates never reach org A's context.

**Check.** The changed triage tests, then the Proof.

**Done when.** Tests 1–9 pass; each guard (flag, `org_id` scope, known-sender check) removed once makes its test fail (listed); Proof `PROOF_OK`.

**Out of scope.** Notice texts (stage 04), the sim (stage 05), reply and follow-up drafts (E6a, E5b).
