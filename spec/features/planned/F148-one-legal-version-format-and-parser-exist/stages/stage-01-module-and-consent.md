# F148 stage 01 — the legal version module and the consent gate on it

Needs: nothing from another stage. Stage 02 needs this stage: `packages/core/src/web/legal-version.ts` (all exports of plan.md § Interfaces).

Part of [`../plan.md`](../plan.md). `[risky]`: `consentCovers` decides which members get open-loop and reply data in Telegram.

## Step 1 — the module

- **Goal:** one pure module owns the version grammar (D1, D2, D4, D5, D7).
- **Files:** new `packages/core/src/web/legal-version.ts` and `legal-version.test.ts` next to it; one export line in `packages/core/src/web/index.ts`. Browser-safe: no Node import (the header of that index says so).
- **Interfaces:** exactly the signatures of plan.md § Interfaces. Do not export the regex.
- **Decisions:** D1, D2, D4, D5, D7. The calendar check of a date: build the UTC date and compare it back with the text (so `2026-02-30` fails); no time-zone math.
- **Test:** plan.md T1–T6, each as a `test.each` table where the shape repeats.
- **Done when:** the T1–T6 tables pass; removing the calendar check fails the `2026-02-30` case of T3; removing the hyphen branch fails T2.

## Step 2 — the consent check runs on the module

- **Goal:** `consentCovers` (in `packages/core/src/web/telegram.ts`) delegates to `legalVersionCovers`; the private consent regex and its parser go away (D6).
- **Decisions:** D5, D6. The name, the signature and the exports of `telegram.ts` stay. The constants `TELEGRAM_CONSENT_VERSION`, `OPEN_LOOPS_CONSENT_SINCE` and `REPLY_CONSENT_SINCE` keep their values. The comment above `TELEGRAM_CONSENT_VERSION` points to the module for the format rule instead of restating it.
- **Test:** keep the existing `consentCovers` cases in `packages/core/src/web/telegram.test.ts` unchanged; add T8 of plan.md (the three constants are canonical; break check: set one to a hyphen form locally); add T7 of plan.md as one table (the four stored consent values × the two `*_SINCE` constants, with the answers at the base: `2026-11-14` false/false, `2026-11-15` false/false, `2026-11-15.2` true/false, `2026-11-19` true/true).
- **Done when:** the old and new cases pass, and the integration files that pass consent strings (`channels-consent.test.ts`, `follow-up-cards.test.ts`, `channels-reply-review.test.ts`) pass with no edit.

## Step 3 — the gate scan and the order tests

- **Goal:** the scan test keeps the consent gate as the one place that compares a consent version; the order tests stop using string order (D6, D9).
- **Files:** `apps/server/src/modules/channels/consent-gate.test.ts`; `apps/web/src/i18n/i18n.test.ts` (T7, T7b, T8).
- **Test:**
  - Scan: a new assert that no server source file names `legalVersionCovers` or `compareLegalVersions` (expected list `[]`). Break check: add a call in a temp server file, see the test fail, remove it.
  - i18n T7, T7b, T8: same meaning, compared with `compareLegalVersions(parseLegalVersion(…))`. A version that does not parse fails the test with its name in the message. T8 keeps its early return while `REPLY_CONSENT_SINCE` is after `TELEGRAM_CONSENT_VERSION`.
- **Done when:** both files pass; with a temporary `TELEGRAM_CONSENT_VERSION = "2026-11-15.10"`, T7 still sees it as after `2026-11-15.2` (check it by hand, then restore; do not commit it).

## Out of scope

`TERMS_HISTORY`, `terms.test.ts`, the legal-text guard test and the docs (stage 02). The route equality checks (D8). Any version value.

## Done when

- Steps 1–3 done.
- The worker result lists each guard (calendar check, hyphen branch, fail-closed null, scan assert) and the test that failed when it was removed.
- The Proof of plan.md ends with `PROOF_OK`, run after the last commit.
