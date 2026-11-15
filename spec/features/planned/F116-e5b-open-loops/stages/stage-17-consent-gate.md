# F116 stage 17 — Consent bump and send-side gate

Part of [`../plan.md`](../plan.md). `[risky]` (privacy, Polish legal-like text). Needs stage 08. Runs before stages 11, 18 and 19, which call the gate.

Owner rule (2026-11-15): a new kind of mail-derived data in Telegram needs a consent bump and a re-ask for linked chats. Loop lines and follow-up cards carry recipients, the ask and the promise of the user's own sent mail (D17).

## Step 1 — The gate

- **Goal:** each sender of loop data can ask "does this user's Telegram consent cover loop data?".
- **Reuse rule:** when F115 stage 12 is on `master` (its consent reader and `POST /api/telegram/consent`), use them and add only `consentCovers` and the constant below. Else build both here with the F115 shapes (`interfaces.md` last line), so the second ticket reuses the first.
- **Interfaces:**
  - `consentVersionsOf(db, ctx, userIds) → Map<userId, string | null>` in `channels`: the version of the user's newest `web.telegram_consent` audit row; no row → null (chats linked before the F098 consent step).
  - `consentCovers(version, since) → boolean` in `packages/core/src/web/telegram.ts`: true when `version` is not null and `version >= since` (versions are ISO dates).
  - `OPEN_LOOPS_CONSENT_SINCE` in the same file = the new `TELEGRAM_CONSENT_VERSION`.
  - `POST /api/telegram/consent` `{ version }` (member, own user only; `apiDoc`): `version` ≠ current → 409 `telegram_consent_outdated`; else one `web.telegram_consent` audit row; 200 `{ version }`.
- **Decisions:** an uncovered user gets no loop text, address or ask in any Telegram message: only counts, a fixed line and the panel link (stages 11, 18, 19 apply it). The gate never blocks a tap answer that holds no loop data.
- **Test (integration):** T1 a user with a `2026-11-15` consent row (the F109 stage 06 text, the version at plan base 09704dcd) and `since` = the new version → not covered; after `POST /api/telegram/consent` with the new version → covered; T2 the route with an old version → 409; T3 a user with no consent row → null, not covered; T4 user B cannot confirm for user A (the route takes the user from the session).
- **Test (unit):** T5 `consentCovers("2026-11-20", "2026-11-20")` true, `("2026-11-15", "2026-11-20")` false, `("2026-11-15", "2026-11-15.2")` false, `("2026-11-16", "2026-11-15.2")` true, `(null, …)` false.

## Step 2 — The bump

- **Goal:** `TELEGRAM_CONSENT_VERSION` gets a new value, strictly greater than the value before this stage (`"2026-11-15"` at plan base 09704dcd, set by F109 stage 06). The consent text (panel key `tg_consent_text` in `apps/web/src/i18n/en.ts` and `pl.ts`) adds one sentence at its end. One commit with the version and both texts (`docs/code-patterns.md` § The consent version).
- **Version value (refresh 1, default):** the land date of this stage. When that date equals the current value (a bump by another ticket on the same day), use `<date>.2` (then `.3`): it sorts after the bare date and before the next day, and fits the 32-character schema. The same-day rule of `docs/code-patterns.md` (keep the version) does not apply here: the gate compares versions, so a kept version would mark a consent to the text without the loop sentence as covered.
- **Text:** en "If you turn on open loops: who you wait for (addresses from your sent mail), a short line of what you asked or promised, and follow-up drafts with their recipients." pl "Jeśli włączysz otwarte sprawy: na kogo czekasz (adresy z wysłanej poczty), krótką linię o tym, o co prosisz lub co obiecujesz, oraz szkice przypomnień z ich adresatami."
- **Decisions:** a new link request with an older version → 409 `telegram_consent_outdated` (the existing check). The panel button "Confirm the new Telegram terms" is stage 22 (unless F115 stage 15 built it).
- **Test (unit):** T6 in `apps/web/src/i18n/i18n.test.ts`: `en.tg_consent_text` and `pl.tg_consent_text` hold the new sentence (fixed Polish value) and still hold the F109 attachment phrase (its test stays); T7 `TELEGRAM_CONSENT_VERSION >= OPEN_LOOPS_CONSENT_SINCE` (a later bump, for example by F115, keeps it true; review N5); T7b `OPEN_LOOPS_CONSENT_SINCE > "2026-11-15"` (the F109 version).

## Check

`bun test packages/core/src/web apps/web/src/i18n apps/server/test/integration/web-telegram.test.ts apps/server/test/integration/<the other touched channels tests>`

## Done when

T1–T7b pass; the Proof of `plan.md` prints `PROOF_OK` (`/tmp/f116-s17`).

## Out of scope

The lines that use the gate (11, 18, 19), the panel button (22).
