---
opened: 2026-11-19
---

# F148 · One legal version format and parser exist

## Outcome

The terms version and the Telegram consent version use one format: a UTC date, and `.2`, `.3` … for a second change on the same day. One core module parses, compares and steps these versions, and both legal stamps use it. Members keep every acceptance and consent they gave: no stored row changes, and nobody is asked to accept again because of this ticket.

## Scope

- A new pure module in `packages/core/src/web/` that owns the version grammar: parse, compare, cover, next.
- The Telegram consent check (`consentCovers`) and its tests run on that module.
- The terms history tests order and check versions with that module; the two old hyphen entries stay as stored, named as legacy.
- The guard test of the legal texts names the next version in its failure message.
- The docs that teach the version rule (`docs/code-patterns.md`, `docs/capabilities/papers.md`) say the one format.

## Out of scope

- Any change of a stored version string (DB rows, audit rows) or of `TERMS_VERSION`, `TELEGRAM_CONSENT_VERSION` and the two `*_SINCE` constants.
- A new legal text or a new `TERMS_HISTORY` entry.
- The equality checks of the accept routes (they stay exact-string).

## Acceptance

- `parseLegalVersion("2026-11-18-2")` and `parseLegalVersion("2026-11-18.2")` give the same version; `"20261115"`, `"2026-02-30"` and `"2026-11-15.1"` give null (plan.md T1–T6).
- `consentCovers` gives the base answer for every existing case of `telegram.test.ts` and for each stored consent value; only the two pairs that plan.md T7 names as changes (D2, D5) differ.
- A `TERMS_HISTORY` entry with a hyphen counter that is not in the frozen legacy list fails `packages/core/src/web/terms.test.ts`.
- No version string changes: `git diff <merge base> -- packages/core/src/web/terms.ts packages/core/src/web/telegram.ts` shows no changed `version:` entry and no changed `*_VERSION` or `*_SINCE` value.
- A server file other than the consent gate that calls `legalVersionCovers` fails `consent-gate.test.ts`.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 9. Decisions: `plan.md`. Two stages, in order; stage 01 is `[risky]` (the Telegram consent gate). How to run: `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: none. Gate: none (quality pass 2, proposed line 7; not in `docs/product/stage-2/05-execution-plan.md` § 2 or `07-foundation-plan.md`).
