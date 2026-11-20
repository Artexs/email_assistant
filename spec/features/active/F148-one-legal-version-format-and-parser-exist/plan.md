# F148 plan — one legal version format and parser

> **Status 2026-11-20 — planned.** Plan base: 22188c54. Two stages, in order.

## Input

Quality pass 2, finding 9 (`spec/quality/2026-11-20-pass-2.md`), word for word:

> **Fix:** One `legalVersion` module in `packages/core/src/web/` (parse, compare, next) used by both; migrate the stored `2026-11-18-2` style or accept both on read. Needs a note in the terms history because the stored strings are compared with user acceptance rows.
> **OWNER:** no.

Facts at the base (scouts in `scouts.md`, then read in the code):

- The terms version is stored in `users.terms_version` and in `web.terms_accepted` audit rows. All reads compare it with `TERMS_VERSION` by exact equality. `TERMS_HISTORY` has no production reader.
- The Telegram consent version is stored only in `web.telegram_consent` audit rows (`data.version`). `consentVersionsOf` reads it; `consentCovers` decides the open-loop and reply-data gates, on the server (`modules/channels/consent.ts`) and in the web panel (`needsNewTerms`).
- Values ever written (git log of the constants): terms `2026-11-12`, `2026-11-17`, `2026-11-18`, `2026-11-18-2`, `2026-11-19`, `2026-11-19-2`, `2026-11-20`; consent `2026-11-14`, `2026-11-15`, `2026-11-15.2`, `2026-11-19`. Audit rows are never rewritten.
- Order checks today use plain string order (`terms.test.ts` test 3, `i18n.test.ts` T7, T7b, T8). String order breaks at a counter of 10.

### Decisions

- **D1 Canonical form: `YYYY-MM-DD` or `YYYY-MM-DD.N`.** N is an integer from 2, with no leading zero. The date is a real calendar date (UTC day of the change). Reason: the consent rows, which are immutable audit rows and decide a privacy gate, already use the dot. Rejected: the hyphen form (it would need a new spelling of rows that gate data).
- **D2 Accept both spellings on read; write only the dot.** `parseLegalVersion` reads `YYYY-MM-DD-N` as the same version as `YYYY-MM-DD.N`. No stored row and no `TERMS_HISTORY` string changes. Reason: rows stay byte-identical, so no member is asked again and the audit trail keeps its strings. Rejected: a data migration (audit rows are append-only; `users.terms_version` holds only old versions that are already not current).
- **D3 The two hyphen entries stay as written and are frozen.** A comment in `TERMS_HISTORY` says they are the legacy spelling of `.2`. `terms.test.ts` holds the frozen list of hyphen entries; every other entry must be canonical. The list holds the hyphen entries of master when stage 02 merges master (`2026-11-18-2`, `2026-11-19-2` at the base). Reason: another active ticket can still append a hyphen entry before this lands. When that entry is the last one, `TERMS_VERSION` is a legacy spelling: the check "`TERMS_VERSION` is canonical" accepts a value in the frozen list, and the worker never renames it (a rename changes `TERMS_VERSION`, and every member gets the terms dialog again). Rejected: rename to dot (breaks the link from stored rows to the history).
- **D4 A bare date is counter 1.** `2026-11-15` < `2026-11-15.2` < `2026-11-15.10` < `2026-11-16`. Reason: same order as `consentCovers` at the base, and correct past 9.
- **D5 Invalid is not covered (fail closed).** `legalVersionCovers(have, since)` is false when `have` is null or either side does not parse. The stricter grammar (D1) rejects `.0`, `.1`, `.02`, impossible dates and whitespace. No stored value is in that set, so no stored consent loses cover. Rejected: keep `\d+` (it allows two spellings of one version).
- **D6 `consentCovers` keeps its name and signature** and delegates to `legalVersionCovers`. The consent-gate scan test keeps working; it also asserts that no server source file names `legalVersionCovers`, so the gate stays the one place that compares a consent version.
- **D7 `nextLegalVersion(current, todayUtc)`** returns `todayUtc` when it is after the date of `current`, else the date of `current` with counter + 1 (never backwards, also for a clock behind the last version). It throws when `current` does not parse or `todayUtc` is not a bare canonical date (a counter or a hyphen in `todayUtc` throws). Core stays pure: the caller passes today. Its user: the failure message of the legal-text guard test (stage 02).
- **D8 Exact-string equality stays** in the accept routes, the auth hook and the `accepted` flag. Reason: they compare with the one current constant; a normalized compare would accept spellings that nobody writes. Out of scope.
- **D9 The ordering tests use `compareLegalVersions`**, not string order: `terms.test.ts` test 3, `i18n.test.ts` T7, T7b and T8. The skip of T8 while `REPLY_CONSENT_SINCE` is ahead of `TELEGRAM_CONSENT_VERSION` (a placeholder pattern) stays.

### Decisions taken (default, owner to confirm)

1. D2: read both spellings, also in the Telegram consent gate. Kind: security, minor. Undo: drop the hyphen branch of the parser after a check that no consent row holds one.
2. D5: the stricter grammar refuses `.0`, `.1`, leading zeros and impossible dates. Kind: security, minor. Undo: widen the regex.
3. D3: the old hyphen entries keep their spelling. Kind: scope, minor. Undo: none needed.

## Interfaces (stage 01 creates, stage 02 uses)

File `packages/core/src/web/legal-version.ts`, exported from `@ea/core/web` (and so from `@ea/core`):

```ts
export interface LegalVersion { date: string; counter: number } // counter 1 = bare date
export function parseLegalVersion(text: string | null): LegalVersion | null;
export function formatLegalVersion(version: LegalVersion): string; // canonical, dot form
export function isCanonicalLegalVersion(text: string): boolean;     // parses and equals its format
export function compareLegalVersions(a: LegalVersion, b: LegalVersion): number; // <0, 0, >0
export function legalVersionCovers(have: string | null, since: string): boolean;
export function nextLegalVersion(current: string, todayUtc: string): string;
```

## Tests (fixed values)

- T1 `parseLegalVersion("2026-11-18")` → `{ date: "2026-11-18", counter: 1 }`.
- T2 `"2026-11-18.2"` and `"2026-11-18-2"` → `{ date: "2026-11-18", counter: 2 }`; `"2026-11-15.10"` → counter 10.
- T3 null for each of: `null`, `""`, `"zzzz"`, `"20261115"`, `"2099-1-1"`, `"2026-02-30"`, `"2026-13-01"`, `"2026-11-15."`, `"2026-11-15.x"`, `"2026-11-15.0"`, `"2026-11-15.1"`, `"2026-11-15.02"`, `"2026-11-15-1"`, `" 2026-11-16"`, `"2026-11-16\n"`, `"2026-11-15.2.3"`.
- T4 `formatLegalVersion` of T2 → `"2026-11-18.2"`; of counter 1 → `"2026-11-18"`. `isCanonicalLegalVersion("2026-11-18-2")` false, `("2026-11-18.2")` true.
- T5 order: `2026-11-15` < `2026-11-15.2` < `2026-11-15.9` < `2026-11-15.10` < `2026-11-16`; `2026-11-18-2` equals `2026-11-18.2`.
- T6 `nextLegalVersion`: (`"2026-11-19"`, `"2026-11-20"`) → `"2026-11-20"`; (`"2026-11-20"`, `"2026-11-20"`) → `"2026-11-20.2"`; (`"2026-11-19-2"`, `"2026-11-19"`) → `"2026-11-19.3"`; (`"2026-11-20.9"`, `"2026-11-19"`) → `"2026-11-20.10"`; (`"bad"`, `"2026-11-20"`) throws; (`"2026-11-20"`, `"bad"`) throws; (`"2026-11-20"`, `"2026-11-21.2"`) throws.
- T7 `consentCovers` keeps every result of `telegram.test.ts` T5 and N1 at the base, and each stored consent value of § Input against `OPEN_LOOPS_CONSENT_SINCE` and `REPLY_CONSENT_SINCE` gives the base answer. New case: (`"2026-11-15.10"`, `"2026-11-15.9"`) true. Two intended changes from the base (no stored row holds either value): (`"2026-11-15-2"`, `"2026-11-15.2"`) false → true (D2); (`"2026-11-15.1"`, `"2026-11-15"`) true → false (D5).
- T8 `TELEGRAM_CONSENT_VERSION`, `OPEN_LOOPS_CONSENT_SINCE` and `REPLY_CONSENT_SINCE` are canonical (a placeholder such as `2099-12-31` still passes).

## Rules for every stage

- `packages/core` stays pure: no `Date.now()` in the module (D7).
- Do not change a version string, a `TERMS_HISTORY` entry, a legal text or a consent text. If `apps/web/src/lib/legal-version.test.ts` fails after `git merge master`, another ticket changed a legal text: stop and report it.
- Format only the stage's files. A gap or a deviation from a decision is a question in the final message, not a choice.
- Each guard test: remove the guard, see the test fail, restore it; list each in the result.

## Proof

```
mkdir -p /tmp/f148 && bun run lint > /tmp/f148/lint.log 2>&1 && bun run typecheck > /tmp/f148/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f148/unit.log 2>&1 && bun run test:int:ci > /tmp/f148/int.log 2>&1 && echo PROOF_OK
```

## Stages

- [01 — the legal version module and the consent gate on it](stages/stage-01-module-and-consent.md) `[risky]`
- [02 — terms history, guard message and docs on the one format](stages/stage-02-terms-and-docs.md)

Stage 02 needs stage 01. No migration, no `bun.lock` change.

## Review

Stage 01 gets a review job before the land (`[risky]`: the privacy gate of Telegram data), model `claude-opus-5-5`. Stage 02 lands on the worker's proof.

## User checkpoints and steps

None. No deploy step: the change has no runtime effect on stored data.

## How to run (coordinator)

Move the ticket to `active/` and commit. Spawn stage 01 with the board flags (worker `claude-sonnet-5-5`, `--thinking high`, `--prepare 'bash scripts/limen-prepare.sh'`), task: "Implement F148 stage 01. Read ticket.md, plan.md and stages/stage-01-module-and-consent.md. Final proof: the Proof of plan.md." Review, land with `--keep-open`, then spawn stage 02 the same way and land it without `--keep-open`.

## Planning progress

- Scouts: 2 (`scouts.md`).
- stage-01 [written], stage-02 [written].
- Word counts (`wc -w`, after the review fixes): plan.md 1484, stage-01 534, stage-02 595, ticket.md 368.
- Questions: 3 minor defaults (`questions.md`); none blocking.

## Cold review

Model `claude-opus-5-5`, because stage 01 is `[risky]` (privacy gate of Telegram data). Result in `plan-review-1.md`: 1 blocking, 5 notes. All taken:

- B1 (ticket acceptance contradicted T7): T7 and the ticket bullet now name the two intended changes apart from the kept base answers.
- N1 (a hyphen last entry fails "`TERMS_VERSION` is canonical"): D3 and stage 02 test 5 accept a frozen legacy value; the worker never renames.
- N2 (consent constants not held to the format): new T8 in stage 01.
- N3 (`todayUtc` with a counter): D7 throws; T6 case added.
- N4 confirms the values. N5: the stage 02 message also names `TELEGRAM_CONSENT_VERSION`.
