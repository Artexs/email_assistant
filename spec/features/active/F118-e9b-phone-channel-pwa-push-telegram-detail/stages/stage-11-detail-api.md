# F118 stage 11 — Detail and lock API `[risky]`

Part of [`../plan.md`](../plan.md). Needs 10. No migration.

Carry-over reads: `plan.md` D13, D14; `interfaces.md` (routes, audit events); `docs/code-patterns.md` § Add a user command; `channels/routes.ts` (link and consent routes), `channels/consent.ts`, `packages/core/src/web/telegram.ts`; `docs/capabilities/digest-and-notices.md` rule 1.

## Step 1 — Link step and member setting

- **Goal:** the member picks the detail when linking and can change it later.
- **Interfaces:**
  - `POST /api/channels/telegram/link` body gains `detail?: "full" | "minimal"` (default `minimal`). The link transaction stores it on the membership (with the consent row and the token, as today). Org locked and `detail: "full"` → `409 telegram_detail_locked`, no token.
  - `GET /api/channels/telegram` gains `detail` (stored), `effectiveDetail`, `locked`.
  - `PATCH /api/me/telegram-detail` `{ detail, consentVersion? }`: `full` needs `consentVersion` = `TELEGRAM_CONSENT_VERSION` (else `409 telegram_consent_outdated`, as the link route) and writes `web.telegram_consent` in the same transaction; `minimal` needs no consent. Locked and `full` → `409 telegram_detail_locked`. Audit `member.telegram_detail_changed` `{ detail }`.
  - The CLI `telegram:link` keeps the stored value (D13).
  - Flag `telegram_minimal` off → the `detail` field and the PATCH route answer as a feature that is off (the link route ignores `detail` and keeps today's behaviour; PATCH → 404).
- **Test (integration):**
  1. Link with no `detail` → membership `minimal`.
  2. Link with `full` and the current consent → `full`; with an old consent → 409, nothing stored.
  3. PATCH `minimal` without consent → stored; PATCH `full` without consent → 409.
  4. Org locked: PATCH `full` → 409 `telegram_detail_locked`; link with `full` → 409, no token.
  5. Flag off: PATCH → 404; link with `full` → linked, detail column unchanged.
  6. A member of org B cannot change org A's membership (own row by session).
  7. The audit rows hold the value and no other data.

## Step 2 — Org lock

- **Goal:** `PATCH /api/organization/telegram-lock` `{ locked: boolean }`, owner only (`requireOwner`); `GET /api/organization` (or the route that serves org settings at `HEAD`) shows `telegramMinimalLocked`. Audit `org.telegram_lock_changed` `{ locked }`.
- **Decisions:** D14: the lock does not change member values. Flag off → 404.
- **Test (integration):**
  1. Owner locks → a member's next notice renders `minimal` while the member's column stays `full`; unlock → `full` again.
  2. A member → 403 `owner_only`.
  3. Suspended org → `403 org_suspended`.
- **Mutation guard:** remove `requireOwner`, the lock check of PATCH and the consent check of `full` in turn; see a test fail each time; list them.
- **Check:** the touched tests, then the Proof.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** the panel cards (12).

## Carry-over from the stage 10 review (PASS 908b6489)

First commit of this stage (before the API), each with a test and a mutation log:
- NOTE 1 (proven): `/pause` and `/resume` print the own mailbox address at `minimal` (`switchMailboxes`, `channels/commands.ts` ~312-341). Use `telegramDetailOf` and "Mailbox n" like `/status` (plan D12, Q4 default). This must land before a member can select `minimal`.
- NOTE 2 (owner decision, default taken): a card edit at `minimal` has no Reject button, also when the card was sent at `full`, and a `full` card has no panel link. Default: at `minimal`, the edit adds the panel link line `/approvals?id=<send id>` when the original text has none. Test it. Keep no button.
- TG1: `queueNotice` check-render must cover `full` always, plus the member level when it is `minimal` (`channels/notice-queue.ts:57-62`); test a `full` render that throws.
- TG2: test a card sent at `full`, member now at `minimal`, then a tap edit (test 5g uses a card queued at `minimal`).
- Cost: a batch reader of the detail level in the digest and notice loops (today 1-2 queries per `queueNotice`, 1000 members = up to 2000 queries); do it if the diff stays small, else note it.
- NOTE 9: add the operator step "turn `telegram_minimal` off before a code rollback; let pending rows drain before a rollback to code older than stage 09" to rule 3e of `docs/capabilities/digest-and-notices.md`.
- NOTE 10: `docs/capabilities/account-data.md:28` and `docs/architecture.md:318` must name `memberships.telegram_detail` and `organizations.telegram_minimal_locked`.
