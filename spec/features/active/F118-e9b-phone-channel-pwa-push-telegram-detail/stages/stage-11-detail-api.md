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
