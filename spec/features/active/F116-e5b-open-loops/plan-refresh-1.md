# F116 · Plan refresh 1 (2026-11-15)

Part of [plan.md](plan.md). Old base: `9531f16a`. New base: `09704dcd` (`HEAD`). No cold review: the job said not to run one. The changes fix values and add one decision and one test per stage. No interface, schema, migration or stage order changed.

## Drift output

```
$ scripts/plan-drift.sh spec/features/planned/F116-e5b-open-loops 9531f16a
plan base: 9531f16a 2026-11-15 06:30
HEAD:      09704dcd 2026-11-15 07:21
named paths: 21; changed since base: 3; gone: 0
changed: apps/server/test/integration/reports-digest.test.ts
changed: packages/core/src/features.ts
changed: packages/core/src/web/telegram.ts
commits after the base that touch the named paths:
  1d39bc51 11-15 05:34 F109 stage 06: attachment line in the urgent notice and the digest (flag attachment_line), consent text and version bump for attachment names
```

## Changes

- Stage 17 Step 1, T1 and T5: the "older consent" value is now `2026-11-15` (the F109 version at `HEAD`), not `2026-11-14`. T5 adds the `.2` cases. Why: `2026-11-14` is no longer the current version, and the real case is a user who confirmed the F109 text.
- Stage 17 Step 2, Goal: the new version must be strictly greater than `"2026-11-15"`. On a day that already has a bump, use `<date>.2`. This replaces the line "Two bumps on one day give one version". Why: the gate compares versions with `>=`. If stage 17 lands on 2026-11-15 and keeps the version, a consent to the F109 text (no loop sentence) counts as covered. That is a privacy hole. New default: questions.md item 20.
- Stage 17 Step 2, text location: the consent text is the panel key `tg_consent_text` in `apps/web/src/i18n/en.ts` and `pl.ts`. It is not in `packages/core/src/texts/`. The sentence goes at the end of the text, and the F109 attachment phrase stays.
- Stage 17 T6, new T7b and Check: T6 lives in `apps/web/src/i18n/i18n.test.ts` next to the F109 test. T7b checks `OPEN_LOOPS_CONSENT_SINCE > "2026-11-15"`. The Check now runs `apps/web/src/i18n` and `web-telegram.test.ts`.
- Stage 18 Step 1: a row's 📎 line goes with its row in the 4096 cut. Brief lines get no 📎 line (default, questions.md item 21). Why: F109 added the 📎 line after the subject in digest rows.
- Stage 18 T9 and new T10: with `open_loops` off, the render stays byte-equal also when `attachment_line` is on, and the F109 test in `reports-digest.test.ts` passes unchanged. T10 has both flags on: the 🔴 line has no 📎, and the `info` row has `📎 1: faktura.pdf (120 kB)`. Other wording in stage 18 is shorter so the stage stays at 700 words. No decision changed.
- interfaces.md: the consent route is now `POST /api/telegram/consent`, the same as stage 17 and F115 stage 12. Before, it was `/telegram/consent`. It also states the `OPEN_LOOPS_CONSENT_SINCE` bound.
- facts.md: new F10–F12 (checked at `09704dcd`).
- questions.md: new items 20 `[important: privacy]` and 21 `[minor]`.
- plan.md: status line `Plan base: 09704dcd, refreshed 2026-11-15`, plus a link to this file in Planning progress.

## Checked, no change needed

- `features.ts`: `attachment_line` (E3b) is new. `open_loops` and `delegate_button` are still absent, so stage 07 adds them with no name clash. `tenancy-features.test.ts` lists flags in registry order, and stage 07 adds its two flags there (the worker's detail).
- `TELEGRAM_CONSENT_VERSION` stays in `packages/core/src/web/telegram.ts`. The link route checks it by equality (`channels/routes.ts`), so the 409 decision of stage 17 holds. Audit event `web.telegram_consent` exists and holds `version`.
- No `consentCovers`, `consentVersionsOf` or consent route exists yet at `HEAD`. F115 stage 12 has not landed, so the reuse rule of stage 17 still applies.
- No stage gives line numbers for the three changed files.
- No landed commit did a step of this plan.
- Existing panel routes are under `/api/channels/telegram/…`. The new route name `/api/telegram/consent` is shared with F115, so I kept it. The coordinator can align both tickets to `/api/channels/telegram/consent` if it wants.
- Words: plan.md 1,499; stage 17 692; stage 18 700.
