# F148 scouts

Two scouts (claude-sonnet-5-5, medium), base 22188c54. Each packet is copied whole from the job log.

## Scout 1

Question: Where are legal version strings stored and read back? Cover the terms version (TERMS_VERSION, TERMS_HISTORY in packages/core/src/web/terms.ts) and the Telegram consent version (TELEGRAM_CONSENT_VERSION, OPEN_LOOPS_CONSENT_SINCE, REPLY_CONSENT_SINCE, consentCovers in packages/core/src/web/telegram.ts). For each: the DB table and column or audit_log data field that holds the string, every code path that reads a stored string back and how it compares it (equality with the current version, consentCovers, lookup in TERMS_HISTORY by version, display to a user, export/DSR). Say whether any stored row can hold a version in the hyphen-suffix form (2026-11-18-2) or the dot-suffix form (2026-11-15.2), and what would break if the TERMS_HISTORY strings were renamed. Context: spec/features/planned/F148-one-legal-version-format-and-parser-exist/ticket.md and spec/quality/2026-11-20-pass-2.md finding 9. Answer for the code at HEAD.

Job: 2026-11-20-f148-scout-1-95cd1d93

Packet: where terms and Telegram-consent version strings are stored, how they are read back, and what a TERMS_HISTORY rename breaks
Base: 22188c54
Verified: `git status --short | wc -l` -> `0` (worktree clean); code read via grep and file reads. I ran no test and queried no DB.
Unknowns: Which strings production rows hold is unknown. No prod DB is available. The code can only write the forms listed in finding 5. Older code may have written other forms, and the test fixtures show `2026-11-15.1/.2/.3`.

1. **Terms version, store** — observed.
   - Column `users.terms_version` (text, nullable). `terms_accepted_at` is its pair, and a CHECK ties the two together (`db/migrations/20261112200001_auth_public.sql:4-6`).
   - Audit row `web.terms_accepted` with `data: {via, version}` (`audit/repo/events.ts:80`).
   - Writers: `setUserTerms` (`tenancy/repo/users.ts:75`, only `WHERE terms_version IS DISTINCT FROM ${version}`), `tenancy/routes.ts:176-180`, `web-audit.ts:74`, `platform/auth.ts:342`. All of them write the constant `TERMS_VERSION`, never a client string.
   - Gates: `routes.ts:170` and `auth.ts:228` demand body version `===` `TERMS_VERSION`.
2. **Terms version, reads** — observed.
   - `tenancy/routes.ts:104`: `accepted = profile.termsVersion === TERMS_VERSION` (plain equality) and `current: TERMS_VERSION`. The web `AppShell.tsx:109` shows `TermsDialog` while `accepted` is false.
   - Display: `legal_version` text in `pages/legal/[lang]/[doc].astro:37` and `e2e legal.spec.ts:51`. Both show the current `TERMS_VERSION`, never a stored string.
   - Export/DSR: `users.terms_version` is in the export allow-list (`privacy/export-map/tables-t-z.ts:45`). `audit_log.data` is exported whole (`tables-a-d.ts:34`).
   - `TERMS_HISTORY` has no production reader. It only feeds `TERMS_VERSION = last entry` (`terms.ts:30`). Tests use it: `terms.test.ts:17-38`, `legal-version.test.ts:29` (last digest equals the digest of the current texts), `web-terms.test.ts:282` (`TERMS_HISTORY[0]` as the stub-era row). No code looks a stored string up in it.
3. **Telegram consent, store** — observed.
   - No column. The string is `audit_log.data->>'version'` on event `web.telegram_consent` (`events.ts:81`), with `actor` = user id.
   - Writers: `channels/routes.ts:121-125` and `telegram-detail.ts:72-74`. Both write the constant `TELEGRAM_CONSENT_VERSION`, after an equality check (`routes.ts:81,118`; `telegram-detail.ts:137`). Also the e2e seed `scripts/lib/e2e-loops-rows.ts:80`.
4. **Telegram consent, reads** — observed.
   - `consentVersionsOf` (`channels/consent.ts:15-47`) takes the newest consent row per user that is not older than the user's last `chat.unlinked` row. It reads `data.version` as a string, otherwise null.
   - `loopConsentOf` runs `consentCovers(v, OPEN_LOOPS_CONSENT_SINCE)` and `replyConsentOf` runs `consentCovers(v, REPLY_CONSENT_SINCE)` (`consent.ts:58,72`).
   - `ownConsentVersion` returns the string to `GET /channels/telegram` as `consentVersion`.
   - The web `lib/telegram-consent.ts:12-13` runs `consentCovers` on that string, against `TELEGRAM_CONSENT_VERSION` for loops and `REPLY_CONSENT_SINCE` for replies.
   - `consentCovers` (`core/web/telegram.ts:47-60`) parses with `^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$`. It compares the date as text, then the suffix as a number. Null or any non-matching string is **not covered**, on either side.
5. **Can a stored row hold the hyphen or dot form?** — observed for the code, guessed for prod data.
   - Terms: `users.terms_version` and the audit `data.version` can hold any `TERMS_HISTORY` string. That includes the hyphen forms `2026-11-18-2` and `2026-11-19-2`, which are accepted values at HEAD or earlier. No parser reads them back. They only fail the equality with the current version, which means "asked again".
   - Consent: the writer is gated to `"2026-11-19"` (bare date), so HEAD never writes a hyphen or dot form. Hyphen-form consent was never a valid value: `consentCovers` returns false for it, so a user holding one loses open-loop and reply data in Telegram. Dot-form rows (`2026-11-15.N`) may exist from older consent texts (guessed). The dot form is what the parser accepts, and the `OPEN_LOOPS_CONSENT_SINCE` constant is `"2026-11-15.2"`.
   - If a rename is not applied to stored rows, the effect differs by string. A terms string that is no longer current only triggers re-acceptance. A consent string that does not parse silently means "not covered".
6. **Rename of the TERMS_HISTORY strings** — observed.
   - No production lookup by version, so nothing breaks at runtime from the rename alone.
   - Stored `users.terms_version` rows with old strings keep failing equality, the same as now. Only the current (last) string matters. If the last string changes, every member sees the dialog again.
   - Tests that pin strings: `terms.test.ts:25` (`{version:"2026-11-12", sha256:null}`), `telegram.test.ts:41` (consent version pinned with the history entry), `web-terms.test.ts:282`. The sort/uniqueness assertions at `terms.test.ts:19-32` may encode the hyphen format. I did not read them.
   - `TELEGRAM_CONSENT_VERSION` and `REPLY_CONSENT_SINCE` (`"2026-11-19"`) are independent constants. A TERMS_HISTORY rename does not touch them. Consent changes only if those constants or the `CONSENT_VERSION` regex change.

Checks: `packages/core/src/web/terms.test.ts`, `telegram.test.ts`, `apps/web/src/lib/legal-version.test.ts` and `apps/server/test/integration/web-terms.test.ts` cover history shape, digest match, equality and the stub-era bump; they miss a stored hyphen-form string passing through `consentCovers`, and any DB-wide rename or backfill.
[limen 2026-11-20T09:00:53.577Z] note check sent
bash test -z "$(git status --short)" && git rev-parse --short HEAD && grep -n "termsV
wait
think
The packet is the one above. The note is complete except for the production-data gap.

## Scout 2

Question: Which tests, scan tests, docs and web code pin the legal version formats or their parsers? Cover apps/web/src/lib/legal-version.test.ts, apps/web/src/lib/legal-checks.ts, apps/web/src/i18n/i18n.test.ts (consent text test), apps/server/src/modules/channels/consent-gate.test.ts, apps/server/src/trust-docs.test.ts, docs/capabilities/ pages, docs/legal or trust pages, and any web page that shows a version string to a user. For each: what it asserts about the version string form (regex, order, last entry, equality), and whether a new shared module packages/core/src/web/legal-version.ts (parse, compare, next) used by both terms.ts and telegram.ts would break or need a change there. Also: how packages/core exports web modules (index files, @ea/core/web) and whether a core module may be imported by apps/web. Context: spec/features/planned/F148-one-legal-version-format-and-parser-exist/ticket.md and spec/quality/2026-11-20-pass-2.md finding 9. Answer for the code at HEAD.

Job: 2026-11-20-f148-scout-2-dfc7b418

Packet: Which tests, docs and web code pin the legal version formats or their parsers, and would a shared `packages/core/src/web/legal-version.ts` break them?
Base: 22188c54
Verified: `git status --short | wc -l` -> `0`. I ran no test. I read the files below.
Unknowns:
- I did not run any test, so "would not break" is inferred from the asserts I read.
- I did not read the stored-row side. Stored `users.terms_version` and Telegram consent rows keep their old strings. The finding's "migrate or accept both on read" needs a decision on this.
- `apps/web/e2e/tests/legal.spec.ts` only renders `TERMS_VERSION`; I did not run it.

1. `packages/core/src/web/terms.test.ts` (tests 3 and 4) — observed. Each `TERMS_HISTORY` version must match `/^\d{4}-\d{2}-\d{2}(-\d+)?$/` (hyphen suffix). Versions must be unique. `[...versions].sort()` must equal the original order, so plain string sort fixes the order. The first entry must be exactly `{version:"2026-11-12", sha256:null}`. `TERMS_VERSION` must equal the last entry. Test 3 breaks if the new format drops the `-N` suffix or changes the history strings. Note: the string-sort order holds only up to `-9`, because `-10` sorts before `-2`; a comparator would fix that. Test 3's regex needs a change only if the stored form changes. Keeping the hyphen form on the terms side breaks nothing.
2. `packages/core/src/web/telegram.test.ts` and `telegram.ts:32-60` — observed.
   - `consentCovers` parses with `/^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/` (dot suffix). Date compares as text, suffix as a number.
   - Test "N1" requires that garbage, `"2026-11-15."`, `"2026-11-15.x"`, `"2099-1-1"`, `" 2026-11-16"`, `"2026-11-16\n"` and an invalid `since` all give false.
   - Test "T5" pins `"2026-11-15.10" >= "2026-11-15.2"`.
   - The pin test requires `TELEGRAM_CONSENT_VERSION === "2026-11-19"`. A test also pins `REPLY_CONSENT_SINCE === TELEGRAM_CONSENT_VERSION`.
   - `consentCovers` can move onto the shared parser and comparator if it keeps these results. This includes accepting the dot form on read and treating invalid input as "not covered". If the parser also accepts the hyphen form, no test here breaks.
3. `apps/web/src/i18n/i18n.test.ts:138-174` — observed. It imports the three constants from `@ea/core`. T7 asserts `TELEGRAM_CONSENT_VERSION >= OPEN_LOOPS_CONSENT_SINCE` and T7b asserts `OPEN_LOOPS_CONSENT_SINCE > "2026-11-15"`. T8 asserts `REPLY_CONSENT_SINCE <= TELEGRAM_CONSENT_VERSION` before it checks that the consent text names reply data. All three use raw JS string comparison, not `consentCovers`. They break if a constant moves to a form that does not sort as a string. The date-then-dot-suffix form still sorts correctly there. A `.10` suffix would not. They need a switch to the shared compare if the form changes.
4. `apps/server/src/modules/channels/consent-gate.test.ts:19-30,66` — observed. It is a source scan, not a format test. Only `modules/channels/consent.ts` may reference `consentCovers`, `OPEN_LOOPS_CONSENT_SINCE` and `REPLY_CONSENT_SINCE` (`usersOf(...)`). If the new module is not named `consentCovers`, nothing breaks. If `consent.ts` calls the shared comparator in place of `consentCovers`, the scan's regex needs updating. A new import of the shared module elsewhere in the server is not caught by this scan.
5. `apps/server/src/trust-docs.test.ts:76` — observed. It only asserts that the trust page contains the text `` `TERMS_VERSION` ``. It does not assert any format. The doc pages `docs/capabilities/papers.md` (rule 5 and the table at line 30, which names `TERMS_HISTORY` and `TERMS_VERSION` in `terms.ts`), `trust.md:119`, `web-panel.md` (rules 13, 15; line 152) and `reply-drafts.md:28` (names the consent version `2026-11-19`) describe the format. They need a text update after the change and break no test.
6. `apps/web/src/lib/legal-version.test.ts` and `legal-checks.ts` — observed. They do not pin the version string form. The test only checks that the last `TERMS_HISTORY` digest equals `legalTextsDigest(legalTextParts())`. `legal-checks.ts` hashes text and has no version parser. The shared module needs no change here. Moving `TERMS_HISTORY` to another file would break the `apps/web/src/lib/legal-version.test.ts` import and the error text, which says to edit `terms.ts`.

Web code that shows or sends a version string (equality or display only, no parse) — observed:
- `apps/web/src/pages/legal/[lang]/[doc].astro:37` and `e2e/tests/legal.spec.ts:51` print `TERMS_VERSION`.
- `apps/web/src/lib/auth-requests.ts:11` sends it.
- `lib/telegram-consent.ts:12` calls `consentCovers`. This is the only parsing call in the web code.
- `TelegramLink.tsx` and `TelegramDetail.tsx` send `TELEGRAM_CONSENT_VERSION`.
- The server compares with `!==` in `tenancy/routes.ts:104,170`, `platform/auth.ts:228`, `channels/routes.ts:81,118` and `channels/telegram-detail.ts:137`. Equality means stored strings must stay byte-identical, or the user must accept the terms again.
- Integration tests use literal strings: `terms_version: "2026-11-12"` (`auth-public-schema.test.ts:44`), `"2026-11-15.2"` and `.1`/`.3`/`zzzz` (`channels-consent.test.ts:156`, `channels-reply-review.test.ts:407`), `follow-up-cards.test.ts:301` (garbage, `"2026-11-15."`, `"20261115"`) and `OLD_CONSENT = "2026-11-15"`. All of them use the dot form for consent rows. They break if the parser stops accepting it, or if it starts to accept `"20261115"`.

Core exports — observed:
- `packages/core/package.json` exports `"."` -> `src/index.ts`, `"./web"` -> `src/web/index.ts` and `"./push"`.
- `src/web/index.ts` is a list of `export * from "./x"`. Its header says the browser imports only this file, and no module there may pull a Node module. `terms.ts` and `telegram.ts` are in the web index.
- apps/web imports `@ea/core/web` (195 import lines) and also `@ea/core` and `@ea/core/push` (a few each).
- A new `web/legal-version.ts` must be added to `web/index.ts`. Apps/web may import it from `@ea/core/web` if it stays pure with no Node imports. `@ea/core` (`src/index.ts`) also re-exports `consentCovers` (the server imports it from `@ea/core`). The new module must be re-exported there too, or the server imports it from `@ea/core/web`.

Checks:
- `packages/core/src/web/terms.test.ts` covers the hyphen form, uniqueness, string-sort order and the last entry; it misses `-10` ordering.
- `packages/core/src/web/telegram.test.ts` covers `consentCovers` accept and reject cases and the pinned constants; it misses the hyphen form.
- `apps/web/src/i18n/i18n.test.ts` covers the constants' order by string compare; it misses `consentCovers`.
- `consent-gate.test.ts` covers the call sites of the consent version by regex; it does not cover the shared module.
- `apps/web/src/lib/legal-version.test.ts` covers the digest of the legal texts; it misses the version format.
