# F148 plan review 1

Job: 2026-11-20-f148-plan-review-0bdb7219 (claude-opus-5-5, thinking high). Final message filed whole.

FAIL 3428c35b924266892bea7fe819894145a510da49

HEAD is `3428c35b924266892bea7fe819894145a510da49` and matches the candidate. The plan base is `22188c54`. Master is at `8f20e94a`. Since the base, master has not changed `terms.ts`, `telegram.ts`, `i18n.test.ts`, `consent-gate.test.ts`, `legal-version.test.ts`, `docs/code-patterns.md` or `papers.md` (`git diff --stat 22188c54 master -- …` was empty).

## Blocking

**B1 (proven, by probe). Ticket acceptance bullet 2 contradicts plan T7. No implementation can meet both.**
- The ticket (`ticket.md`, Acceptance bullet 2) says: "`consentCovers` gives the same answer as at the plan base for every case in plan.md T7."
- Plan T7 (`plan.md` § Tests, T7) asks for two answers that differ from the base. I ran a bun probe of the current `consentCovers` (`packages/core/src/web/telegram.ts:47-61`):
  - `consentCovers("2026-11-15-2", "2026-11-15.2")` returns **false** at the base. T7 wants **true** (D2: read the hyphen form).
  - `consentCovers("2026-11-15.1", "2026-11-15")` returns **true** at the base, because suffix 1 ≥ suffix 0 (`telegram.ts:52,60`). T7 wants **false** (D5: `.1` is invalid).
- A stage 01 worker who follows T7 breaks ticket bullet 2, and the `[risky]` stage 01 review must cite that bullet. A worker who keeps the base answers breaks T7, D2 and D5.
- Fix: reword bullet 2. It should require the base answers for T5, N1 and the stored-value × `*_SINCE` table. The two new pairs should be named as intended changes (D2, D5).
- No stored row or constant ever held `.1` or a hyphen consent value, so neither change reaches a member. The consent constant history `6a57448c`, `1d39bc51`, `60c40280`, `21e56204`, `602e7261` agrees with plan § Input. The defect is in the acceptance text, not in the behaviour.

## Notes

**N1 (plausible). Stage 02 test 5 conflicts with D3 in the case D3 was written for. This is the pre-mortem path to "every member accepts the terms again".**
- D3 (`plan.md` § Decisions) expects that "another active ticket can still append a hyphen entry before this lands". Such an entry is appended, so it is the last entry, and `TERMS_VERSION` takes its value (`terms.ts:24-30`).
- Stage 02 Step 1 test 5 ("`TERMS_VERSION` is canonical") then cannot pass. The plan forbids a version change ("Rules for every stage"), and no stage says what to do.
- A Sonnet worker must guess. The tempting guess is to rename the last entry to the dot form. That changes `TERMS_VERSION`, and every member gets the terms dialog again (`tenancy/routes.ts` equality, per scout 1).
- The risk is real. F153 is active, and its stage file still says "`-2`, `-3` … when that date has one" (`spec/features/active/F153-…/stages/stage-01-privacy-and-shared-check.md:29`). F153 already wrote the `2026-11-20` entry (commit `2e3d426a`).
- Fix: decide that test 5 accepts `TERMS_VERSION` when it is canonical or in `LEGACY_HYPHEN_VERSIONS`. The other fix is a stop-and-report rule for this case.

**N2 (plausible, missing test). Nothing enforces the one format on the consent stamp.**
- The ticket outcome says "both legal stamps use" the format. Stage 02 test 5 checks only `TERMS_VERSION`.
- With D2, a future `TELEGRAM_CONSENT_VERSION = "2026-11-21-2"` parses and passes every planned test (i18n T7, `telegram.test.ts`).
- Fix: assert `isCanonicalLegalVersion` for `TELEGRAM_CONSENT_VERSION`, `OPEN_LOOPS_CONSENT_SINCE` and `REPLY_CONSENT_SINCE` in stage 01.
- A placeholder such as `2099-12-31` (used in commit `21e56204`) is still canonical, so this check does not block that pattern.
- Fail-closed already catches an invalid constant: `telegram.test.ts:51` and the planned "does not parse" message in i18n T7. Only the hyphen spelling gets through.

**N3 (plausible, edge case). D7 does not say how `nextLegalVersion` treats a `todayUtc` with a counter or a hyphen** (for example `"2026-11-20.2"`). T6 covers only `"bad"`, which throws. The worker must guess: throw, or use the date part. Proposal: throw unless `todayUtc` is a bare canonical date, and add that case to T6.

**N4 (proven, by reading and probe). Every other T value holds at HEAD or follows from the decisions.**
- Stage 01 Step 2 table: the base answers `2026-11-14` F/F, `2026-11-15` F/F, `2026-11-15.2` T/F, `2026-11-19` T/T. The probe gave the same eight results.
- `telegram.test.ts` T5 (`:6-15`) and N1 (`:17-28`) give the same results under D1, D4 and D5. N1's `"2026-11-15.1"` against `.2` is false at the base and false under the new grammar.
- The `.10 ≥ .2` hand check of stage 01 Step 3 tells old from new: the probe shows the string compare `"2026-11-15.10" >= "2026-11-15.2"` is false.
- The other integration and web tests that use consent strings keep their expected results under the new grammar:
  - `channels-consent.test.ts:156`: the POST route is exact-equality and still returns 409.
  - `follow-up-cards.test.ts:301`: `"20261115"` is still null.
  - `telegram-consent.test.tsx:16`: `.1` is still not covered.
- The stage 02 Step 3 grep finds exactly `terms.ts:4` and `terms.test.ts:18` at HEAD, as the plan says.
- `@ea/core` re-exports the web index (`packages/core/src/index.ts:10`). No export name of the new module exists yet.
- The docs stage 02 edits are not inputs of `legalTextParts` (`apps/web/src/lib/legal-checks.ts:17` reads `apps/web/src/legal`), so the docs edit cannot move the digest.

**N5 (plausible, minor). The guard message in stage 02 Step 2 names only the next terms version.** If the text change touched `tg_consent_text`, `TELEGRAM_CONSENT_VERSION` must move too (`docs/code-patterns.md:163`). The message could say so. This is a hardening idea, not a gap.

## Categories asked for

- Gaps (an event no rule covers): N1 (hyphen last entry at merge), N3.
- Rules that conflict: B1 (ticket bullet 2 vs T7, D2, D5); N1 (D3 vs test 5).
- Steps a Sonnet worker cannot do without guessing: N1, N3.
- Facts without a source: none found. I checked the version histories in § Input against `git log -G` for both constants and `TERMS_HISTORY`. The "counter of 10" claim is shown by the probe.
- Asserts that cannot hold at HEAD: B1.
- Stages too big for one job: none. `wc -w`: plan.md 1288 (≤1500), stage-01 516, stage-02 560 (≤700). The plan's own § Planning progress records 1270 for plan.md, which is a small drift.
- Pre-mortem answer: the base already left Telegram data and consent safe. No consent row can hold `.1` or a hyphen value, because the writers check exact equality with the constant. The path to "asked to accept the terms again" runs through stage 02 (N1).

## Checks run

- `git rev-parse HEAD` → `3428c35b…`, which matches the candidate.
- A bun probe of the HEAD `consentCovers` on the 3 T7 extra pairs and the 4×2 stored-value table. The output is quoted above. The temp folder was removed, and the tree is clean.
- `git log -G` on the three consent constants and the `TERMS_HISTORY` lines. Results match plan § Input.
- `grep -rnF -e 'YYYY-MM-DD-N' -e '`-2`, `-3`' docs/ packages/core/src apps/web/src` → 2 hits, as the plan says.
- `wc -w` on the plan files: counts above.
- Not run: lint, typecheck, unit and integration suites. This is a plan review and no code changed.

## Note check

- T1-T7 checked against HEAD: not proven by the note rule. I ran the probe in a bash call that also used `;` and `rm`, and its output is not saved in a file. The results are quoted in B1 and N4. I did not rerun the probe only to clear the note.
- Findings quote file and line, labeled: not proven by a file. The evidence is this final message (B1, N1-N5), and it is not a saved file.
- Categories covered: not proven by a file. The evidence is § Categories asked for in this message.
- Easy-to-miss rule (code detail is not a finding): followed, but not proven by a file. B1 and N1-N5 name decisions, tests and edge cases only. No finding asks for line numbers, edit text or file lists.
- Project reminder (merge master and checks before the final message): not applicable. This is a review job, and it made no commit and changed no product code.
