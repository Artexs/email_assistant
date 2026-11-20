# Stage 20 log: exact asserts in core, fake Telegram and integration cases

Group: weak core, fake Telegram and integration cases, action `REWRITE-WEAK` (owner `ok`). Base: merge of master into this branch at `e2bfbc7c`. Raw runs: `/tmp/f125-s20/` (JUnit, lcov, `mutation.json`, name lists; not committed).

## Keys

`cut-keys.ts --group G10` on a fresh scan of the base: 7 keys, 7 `ok`, no `deferred-*`, no `rejected`. No unmerged `limen/*` branch changes a file of the 6 test files or the notices folder (checked with `git diff --name-only master...<branch>` for each of the 6 branches). Nothing is deferred.

## Rows

| Case | Old assert | New assert | Break once (code under test), the case fails |
| --- | --- | --- | --- |
| `packages/core/src/notices/encode.test.ts` "a view without version and panelUrl encodes" | `not.toThrow()` | `toEqual` of the whole encoded object (exact view, ISO `now`, `timeZone`) | `encodeNoticeView` returns `{}`: fails (4 other encode cases fail too) |
| `packages/core/src/notices/encode.test.ts` "version and an https or http panelUrl encode" | two `not.toThrow()` | `toMatchObject` of `view.version` and `view.panelUrl` for the https URL and the http URL | the JSON replacer drops the key `panelUrl`: fails |
| `tools/fake-telegram/src/compat.test.ts` "edit with the same content resolves" | no assert (call must not throw) | `resolves.toBeUndefined()` and `edits` of the stored message `toEqual([])` | the fake no longer refuses an edit with the same content: fails (with the not-modified case) |
| `apps/server/test/integration/mail-oauth-login.test.ts` "an SMTP verifySmtpLogin with an oauth access token passes" | no assert | `resolves.toBeUndefined()` against GreenMail, plus a local recording SMTP server: the one AUTH line it saw is `AUTH XOAUTH2 <base64 of user and Bearer token>` | `verifySmtpLogin` skips `transport.verify()`: fails (the old case passed) |
| `apps/server/test/integration/sso-schema.test.ts` "2b: an https issuer is accepted" | no assert | the row read back: `[{ issuer: "https://login.microsoftonline.com/t/v2.0", domain_verified: false }]` | `insertProvider` skips the insert of that issuer: fails |
| `apps/server/test/integration/mail-connect.test.ts` "the same address in another organization connects" | `toBeDefined()` | `toMatchObject({ id, address })` in the new organization and `undefined` in the first one | `connectMailbox` skips `insertMailbox`: fails (12 other cases fail too) |
| `apps/server/test/integration/trust-repo.test.ts` "another mailbox of the organization has its own open check" | two `not.toBeNull()` | both results are strings and differ; each mailbox holds its own one `queued` row | `queueHistoryCheck` returns `null`: fails (with the case before it) |

Each int case keeps `withRollback`. The oauth case needs a second server because GreenMail with auth off cannot show which login a client sent; its name did not change (the name list diff is empty).

## Files of the proof runs (glob list)

`cut-run.sh` ran these 6 files: `packages/core/src/notices/encode.test.ts`, `tools/fake-telegram/src/compat.test.ts`, `apps/server/test/integration/mail-oauth-login.test.ts`, `apps/server/test/integration/sso-schema.test.ts`, `apps/server/test/integration/mail-connect.test.ts`, `apps/server/test/integration/trust-repo.test.ts`.
Mutation scope: `mutation.sh --mutate` with the 81 non-test files in the import closure of `notices/encode.test.ts` (`src/contacts/address.ts` … `src/web/zod.ts`: the `digest`, `notices`, `outgoing`, `texts`, `triage`, `trust`, `web` and `metrics` files it reaches).

## Name lists

Sorted JUnit `name` lists of before-1, before-2 and after are identical in both lanes (unit 22, int 60): `diff` printed nothing for each pair.

## cut-proof

One mutation run before (`/tmp/f125-s20/mut-before`) and one after (`/tmp/f125-s20/mut-after`) ran with the same `--mutate` list; the before file serves both `--before` dirs. The first `cut-proof` run printed one mutant "Killed -> Survived" (`packages/core/src/triage/suspicious.ts:154:7`, a file no changed test touches). Cause, checked in both `mutation.json` files: two mutants start at that place and differ in their end (ids 6492 and 6495); the compare key had no end, so the later one hid the first, and Stryker lists them in another order in each run. Every id has the same status in both runs. The tool now adds the end place to the key (`mutantPlace` in `scripts/test-audit/mutation-summary.ts`, with a case in `mutation-summary.test.ts`); the section below is the run with the fixed tool.


## G10 REWRITE-WEAK

Before: `/tmp/f125-s20/before-1`, `/tmp/f125-s20/before-2`. After: `/tmp/f125-s20/after`. Expected: unit=+0, int=+0.

| lane | cases before | cases after | serial time before | serial time after |
| --- | --- | --- | --- | --- |
| unit | 22 | 22 | 0.47 s | 0.34 s |
| int | 60 | 60 | 11.06 s | 7.81 s |

- Case counts: pass.
- Covered lines: pass; 1 noise files skipped.
- Mutants: pass; 0 on one side only.

Result: PASS

