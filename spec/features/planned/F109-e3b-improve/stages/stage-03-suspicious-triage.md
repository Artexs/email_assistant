# F109 stage 03 — Rules in triage, no delegation draft for flagged mail

Part of [`../plan.md`](../plan.md). Decisions P1, P8, D2, D4, D5, D6. Needs stages 01 and 02. Review before the land.

## Step 1 — Known-sender context

**Goal.** One reader gives the context of `assessSuspicious` for one mailbox, read once per mailbox batch (not per mail).

**Files.** New `apps/server/src/modules/triage/suspicious-context.ts`; a free-mail list in core next to `suspicious.ts`; config key `MAIL_TRUSTED_AUTHSERV_IDS` (comma list, empty default, lower case) in `platform/config.ts` and `.env.example`.

**Interface.** `loadSuspiciousContext(db, ctx, mailbox): Promise<SuspiciousContext>` with `isKnown(address): boolean`, `knownDomains`, `protectedNames`, `trustedAuthservIds`.

**Decisions (D4).**

- Known addresses: the organization's mailbox addresses, active delegates, exact-address `whitelist` and `vip` rules (mailbox and organization rules), and frequent senders: an address with ≥ 3 mails in this mailbox in the last 90 days whose latest triage category is not `spam`.
- Known by domain: the domains of the organization's mailbox addresses, of delegates and of domain rules (`@corp.test` patterns), except free-mail domains (built-in list, at least `gmail.com googlemail.com outlook.com hotmail.com live.com yahoo.com icloud.com interia.pl interia.eu poczta.fm wp.pl o2.pl onet.pl op.pl gazeta.pl tlen.pl proton.me protonmail.com gmx.de gmx.net web.de`). A free-mail domain never makes a sender known; it stays in `knownDomains`, so `gmai1.com` still counts as a look-alike.
- `knownDomains`: the registrable domains of all known addresses and domain rules.
- `protectedNames`: delegate names, and the newest `email_headers.from_name` of each exact `vip` address from the last 90 days.
- `trustedAuthservIds`: the registrable domain of the mailbox IMAP host, plus `MAIL_TRUSTED_AUTHSERV_IDS` (D2).
- Test mail (synthetic Message-ID or a test sender) uses the same reader; nothing special.

## Step 2 — Reasons on every triage result

**Goal.** Each `triage_results` row written by the classify path or the blocklist path carries `suspicious_reasons`.

**Decisions.**

- Read the mail's `email_headers` row in the same place the service reads the mail. No row (mail older than F100, or a failed capture) → `fromName` null, empty lists, `authResults` null: only `lookalike_domain` can fire. Cleared texts (retention) behave the same.
- `isList` = `list_id` or `list_unsubscribe` set. Attachments: all captured entries (inline too).
- Skipped mail (`too_old`, `suspended_backlog`, `body_expired`) gets no row and no reasons, as today.
- The `email.triaged` audit row adds `suspicious` = the code list. A log line may carry the count, never a host, name or address.

## Step 3 — Flagged delegation mail plans nothing

**Goal.** With the flag `suspicious_mail` on, a flagged mail never gets a delegation draft.

**Files.** The flag in `packages/core/src/features.ts` (`suspicious_mail`, default off, epic `E3b`, remove-by `2027-03-01`, description "Suspicious mail gets a warning and no delegation draft."). The service, before `planActions`.

**Decisions (D6).**

- Flag on and reasons not empty and final category `delegation` → no delegation input, an empty plan, no `delegations` row. The category stays `delegation`; the mail stays in INBOX.
- Other categories keep their plan. A flagged `urgent` mail still gets its flag and its notice (warning text: stage 04).
- Flag off → reasons are stored, the plan is unchanged.
- Whitelist and VIP: the allowed categories do not change (rules of stage 01 give such senders only `auth_fail` or `risky_attachment`).

**Test (integration, fake LLM, fixed values).**

1. Sender `billing@paliwa-fiota.test`, known delegate domain `paliwa-flota.test`, fake answer `delegation`, flag off → reasons `{lookalike_domain}`, delegation draft and row as today.
2. Same with flag on → category `delegation`, no actions, no `delegations` row, mail in INBOX.
3. Whitelisted sender, attachment `run.exe`, flag on, fake answer `urgent` → reasons `{risky_attachment}`, urgent plan unchanged.
4. Mail without an `email_headers` row from an unknown sender on a known-domain look-alike → `{lookalike_domain}`; from a plain unknown domain → `{}`.
5. Blocklisted sender with a `Reply-To` on another domain → spam, `{reply_to_mismatch}`, no LLM call.
6. Sender with 3 earlier `info` mails in 90 days and a `Reply-To` mismatch → `{}` (known). With 3 earlier `spam` mails → `{reply_to_mismatch}`.
7. Mailbox IMAP host `imap.corp.test`, header `mx.corp.test; dmarc=fail` → `{auth_fail}`; header `evil.test; dmarc=fail` → `{}`; with `MAIL_TRUSTED_AUTHSERV_IDS=evil.test` → `{auth_fail}`.
8. Sender `x@gmai1.com` with known `a@gmail.com` → `{lookalike_domain}`; sender `new@gmail.com` → not known, `{}`.
9. Org B rules and delegates never reach the context of org A (two organizations).

**Check.** The new and the changed triage tests, then the Proof.

**Done when.** Tests 1–9 pass; for each guard (flag check, `org_id` scope, the known-sender check) the worker removes it, sees its test fail, restores it, and lists it; Proof `PROOF_OK`.

**Out of scope.** Notice texts (stage 04), the sim (stage 05), reply and follow-up drafts (E6a, E5b read `suspiciousReasonsOf` from stage 04).
