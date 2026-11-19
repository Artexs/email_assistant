---
opened: 2026-11-19
landed: 2026-11-19
---

# F137 · the data request erase keeps every mail of another person and leaves no mail behind for odd whitespace, a dotless i or a Unicode case form

## Outcome

The data request erase and find use one address rule in the SQL form and the program form, also for whitespace and rare case forms. A mail of another person is never touched. A mail of the named person is never left behind. Source: the Opus review of F135 (PASS 95cf055b, `.limen/jobs/2026-11-19-f135-review-erase-address-rule-6006ca65`).

## Scope

- Whitespace: JS `trim()` removes tab, NBSP, U+3000 and newline. SQL `btrim()` removes only spaces. A stored address that ends in such a character is missed by the SQL compare while the profile (JS hash) matches: the erase deletes the profile and keeps the mail, and the next profile pass writes the profile again. Make both forms strip the same set (decide the set; the JS rule wins). Update the "cannot disagree" line in `docs/capabilities/account-data.md` item 8.
- Text regex (`~*`) used by the text scrub and the post-erase check: it over-matches a dotless `ı` (matches `ILKER@x.tr` for `ılker@x.tr`, so a scrub can change another person's address in kept text) and under-matches `ẞ` (U+1E9E), the Ohm sign and the Kelvin sign (the post-erase check cannot see these leftovers). Make the scrub and the check use the same normalised rule as the equality match.
- Test gaps (each proven by a surviving mutation; the review probe test `zz-f135-review-probe.test.ts` kills them, rebuild it as a real test): the "only party besides own mailboxes" branch of `findMails` with a non-ASCII case (mutations M06, M07, M08); an address that JS lower-cased with a dotted capital I (`İLKER@x.tr` stored as `i̇lker@x.tr`, from `triage/newsletter-unsubscribe.ts:152` and `tenancy/members.ts:48`; mutation M22); a plus-tag test with a real tag of `annaσ@x.gr` (M24); a longer address keeps its mail (`annaσ@x.gr.pl`, M25).

## Out of scope

- Org delete (`privacy/delete.ts:40`).

## Acceptance

- A probe over at least 66 strings on the real database shows no difference between the SQL form and the JS form, whitespace included.
- Mutations M06, M07, M08, M22, M24 and M25 are killed by committed tests.
- The text scrub and the post-erase check agree with the equality match on `ı`, `ẞ`, Ohm and Kelvin.
- No migration unless the stage needs one; no `TERMS_VERSION` bump.

## Slices

Four stages, one worker job each, in order, none in parallel; no migration and no `bun.lock` change. Stages 02–04 are `[risky]` and get an Opus review before the land. No owner checkpoint. See `plan.md` § How to run.

## Sequenced

- Plan after: none.
- Build after: F135 (landed; the one address rule that this ticket finishes).
- Gate: none.

## Notes

Risky (privacy, irreversible erase): Opus review before the land.
