# F146 scouts

Three scouts, `claude-sonnet-5-5`, thinking medium, base 22188c54. Each packet is copied whole from the job's last packet message.

## Scout 1

Question: List every place in production code and tests that spells the mail header X-EA-Action-Id (any case), and for each say whether it writes, reads or compares it; which package each site is in and whether that package may import @ea/core. Also list REPORT_MAIL_ID_HEADER uses.

Job: `2026-11-20-f146-scout-1-814c97c9`

Packet: every spelling of X-EA-Action-Id, and every REPORT_MAIL_ID_HEADER use, at HEAD
Base: 22188c54
Verified: `grep -rniI "x-ea-action-id"` and `grep -rnI "REPORT_MAIL_ID_HEADER"` over the worktree, excluding node_modules, .git, spec, docs, notes and .ai -> `./packages/core/src/outgoing/report-mail.ts:10:export const REPORT_MAIL_ID_HEADER = "X-EA-Action-Id";`
Unknowns:
- `tools/mail-oauth-spike/` has no package.json. The root workspaces glob includes `tools/*`, so the folder is not a workspace package. It has no `@ea/core` import (grep found none) and no dependency line. Whether it may import `@ea/core` is guessed: no. Its `X-EA-Action-Id` sites are only in `mail.ts` and `rows-microsoft.ts`.
- I did not list comments in `spec/`, `docs/`, `notes/` or `.ai/` (excluded).
- `deploy/README.md:642` is prose only.

1. **Core, the only definition (`packages/core/src/outgoing/`). Observed.**
   - `report-mail.ts:10`: `REPORT_MAIL_ID_HEADER = "X-EA-Action-Id"`. Its only use in the repo is this definition, and nothing imports it. Finding 7's fix names it for deletion.
   - `report-mail.ts:22` (type) and `:93` write the header as a literal key.
   - `message.ts:24` (type) and `:151` write it as a literal key.
   - Tests that compare it: `message.test.ts:54,252`, `follow-up.test.ts:124`, `report-mail.test.ts:36`. They use exact-case `toEqual` or `Object.keys`.

2. **Server mail module readers (`apps/server`, may import `@ea/core`: dependency `"@ea/core": "workspace:*"`). Observed.** The lower-case form is hard-coded in each:
   - `mail/imap/client.ts:60`: fetch header list `["references", "x-ea-action-id"]`.
   - `mail/imap/mapper.ts:60`: `headers.get("x-ea-action-id")`. The parser lower-cases names, so the match is case-insensitive.
   - `mail/fake/index.ts:448`: `headers.get("x-ea-action-id")`. It is case-insensitive through the raw parser.
   - `mail/fake/index.ts:112`: `findHeader(msg, "X-EA-Action-Id")`. Whether `findHeader` compares case-insensitively is not read.
   - `mail/imap/probe-send.ts:20`: `ACTION_HEADER = "x-ea-action-id"`. Its uses were not read.

3. **Server mail module writers. Observed.**
   - `mail/fake/index.ts:460` writes `{ "X-EA-Action-Id": actionId }` into the stored headers.
   - `mail/imap/probe-send.ts:489` writes `"X-EA-Action-Id": probeId` and `"X-EA-Probe"`.
   - `mail/imap/compose.ts` imports from `@ea/core` and writes the headers through nodemailer, which emits `X-Ea-Action-ID`. Its tests confirm this at `compose.test.ts:53` (case-insensitive regex) and `:116` (exact `X-Ea-Action-ID`).

4. **Server comments and docs only: no behavior. Observed.**
   - `composition.ts:121-122`, `actions/copy.ts:42`, `actions/repo/planned.ts:16,43`, `channels/own-report-mail.ts:8`, `mail/locate.ts:65`, `mail/port.ts:61`.

5. **Server tests. Observed.** Most only write the header with exact-case `"X-EA-Action-Id"` through the fake seed `headers` option. Writers:
   - `mail/seed.test.ts:64`; `test/contract/mail-provider.ts:129,419`.
   - Integration writers: `mail-sync`, `mail-sent-*`, `mail-backfill`, `mail-history-backfill`, `mail-jobs`, `copy-hash-fixtures`, `actions-follow-up:556`, `imap-probe-send:198`, `channels-report-mail-greenmail:198`.
   - `graph-send.test.ts:66` writes the header in a raw MIME string.
   - `contract/mail-sender.ts:39` writes it in a raw MIME string.

   Readers and compares:
   - Case-insensitive: `fake.test.ts:309` (`X-Ea-Action-ID` input), `raw.test.ts:7-11` (mixed-case input, lower-case read, first value wins), `mapper.test.ts:24-122` (lower-case `get`), `locate.test.ts:161,243` (passes `x-ea-action-id` lower-case to `deliver`), `actions-follow-up.test.ts:270` (`/im` regex), `channels-report-mail-append.test.ts:209` (lower-case `get`), `graph-committer.test.ts:231` and `replies-drafter-job.test.ts:186` (`raw.toLowerCase()` contains).
   - Exact-case: `contract/mail-sender.ts:109` (`toContain` of `X-EA-Action-Id: …`), `actions-drafts.test.ts:445` (`message.headers["X-EA-Action-Id"]`), `seed.test.ts:69` (`toContain` of `X-EA-Action-Id: act-1`).

6. **`tools/mail-oauth-spike/`. Observed.**
   - `mail.ts:79` writes `"X-EA-Action-Id"`.
   - `rows-microsoft.ts:269` reads lower-case via `readHeaders`.
   - `rows-microsoft.ts:276-277` compares `headers["x-ea-action-id"] === actionId`. That compares the value, not the name; the name is read with a lower-case key.

Checks: the grep covers every spelling in code and tests (all cases). It misses string-built names, such as `X-EA-${…}`, which I did not search for. I did not read `findHeader` or the `probe-send.ts` uses, so those compare modes are unsettled.

## Scout 2

Question: For hasTrustedAlignedDkimPass, renderDigest, routeOfKind, mailReportKinds, isLogFieldName and EMPTY_URGENCY_DRAFT: every importer at HEAD, whether deleting or making it file-private breaks anything, what the tests that call one cover, whether a test of the production twin covers it, and whether a package index re-exports it.

Job: `2026-11-20-f146-scout-2-a39a04e8`

Packet: importers of six exports, whether removal breaks anything, and which tests cover which twin
Base: 22188c54
Verified: `rg -nw <name> --glob '!node_modules' .` for each of the six names -> `./packages/core/src/notices/routes.ts:74:export function routeOfKind(input: {` (the hits for each name are listed below)
Unknowns: none. Not run: I did not delete any export and re-run typecheck. The "breaks nothing" claims come from grep, which misses dynamic or string-based use.

1. `isLogFieldName` (`apps/server/src/platform/log-fields.ts:207`) and `EMPTY_URGENCY_DRAFT` (`apps/web/src/lib/urgency-form.ts:25`) — observed: each name appears only at its definition, with no importer and no use in its own file. `urgency-form.test.ts` imports from the file but never names the constant. Deleting either breaks nothing.
2. `mailReportKinds` (`apps/server/src/modules/channels/report-members.ts:18`, alias of `reportMailKinds`) — observed: no code importer. Only `docs/capabilities/trust.md` line 29 names it, in prose. `report-members.ts` imports `reportMailKinds` from `@ea/core` for this alias alone. `report-mail-sender.ts:1` and `notices/registry.test.ts` use the core name. Deleting it breaks nothing. Its type alias `MailReportKind` is a separate export and was not checked.
3. `hasTrustedAlignedDkimPass` (`packages/core/src/triage/dkim-pass.ts:80`) — observed: the only caller is `dkim-pass.test.ts`, in its first `describe` (8 tests, lines 8–134). Production uses `hasCoveredDkimPass`, in `apps/server/src/modules/triage/newsletter-senders.ts:141`. Both functions call the file-private `trustedAlignedPassDomains`.
   - **Making it private:** impossible without breaking, because the tests import it. Deleting it breaks only that test file.
   - **Twin coverage is partial:**
     - The twin's 7 tests cover untrusted authserv-id, `dkim=fail`, null header, parent-domain alignment, and a second pass.
     - Nothing in the twin tests covers these cases: case-folding, comments and quoted strings (tests 4–6), malformed values (7), the NUL after `pass`, and shared-suffix domains such as `co.uk` (8).
     - These tests sit in the shared lexer. To keep them, move them to call `hasCoveredDkimPass` with a covering signature, or export `trustedAlignedPassDomains` instead.
4. `renderDigest` (`packages/core/src/digest/digest.ts:476`) — observed: it is a one-line wrapper for `renderDigestWithBrief(input, texts).message`.
   - **Callers:** `digest.test.ts` (lines 63–160 and the `render` helper at line 343, which feeds the English and Polish `describe` blocks) and `loops/brief.test.ts:564`. There is no production caller.
   - **Twin coverage:** `digest.test.ts` never calls the twin; only `brief.test.ts` and `brief-keyboard.test.ts` do. The digest text, limit and Polish cases have no twin test. A swap is mechanical: change the helper at line 343 and the inline calls to `.message`.
   - **Line 564:** `brief.test.ts` compares the no-brief twin text with `renderDigest(...).text`, so after deletion it compares the twin against itself and checks nothing.
5. `routeOfKind` (`packages/core/src/notices/routes.ts:74`) — observed: the only caller is `routes.test.ts:104–108`, in the test "a notice of a kind with no group never goes to push…". It covers 5 group-less kinds with push chosen everywhere, plus `urgent`, `sync_ok` and `approval_set`.
   - **Twin coverage:** the `effectiveRoute` tests cover `group: null` at lines 78–79 and the default routes at 21–30. Nothing else covers the kind-to-group lookup through `noticeGroupOf`. Production callers use `effectiveRoute`: `notice-fan-out.ts`, `notify-settings.ts`, `apps/web/src/lib/notice-routes.ts`.
6. Re-exports — observed: no `web.ts` exists in `packages/core/src`; `web` is a folder. `packages/core/src/index.ts` has `export * from "./triage"`, `"./digest"`, `"./notices"` and `"./web"`.
   - `triage/index.ts:5` re-exports `./dkim-pass` and `notices/index.ts:7` re-exports `./routes`, so those two names are public from `@ea/core`. No importer outside the test files uses them.
   - `digest/index.ts` has no `export * from "./digest"` line in its first 10 lines; I did not read the rest. `renderDigestWithBrief` and `renderDigest` are imported by relative path (`../digest/digest`) in `loops/brief.test.ts`.
   - The other three names live in `apps/*` and are not in any core index.

Checks: the `rg` runs and file reads above cover importers in `apps`, `packages`, `scripts`, `tools` and `evals` (no hits in `apps/docs`, `scripts`, `tools` or `evals`); they miss dynamic or string-based use. No test or typecheck was run, so none of the above is confirmed by a run.

## Scout 3

Question: expiredFlags in packages/core/src/features.ts: who calls it at HEAD, what it returns, what the comment promises, which flags are past or near their remove-by date, and where a 'past its date fails' check could live.

Job: `2026-11-20-f146-scout-3-e7f45a2f`

Packet: expiredFlags at HEAD — callers, return value, comment promise, flags near their remove-by date, and where a "past its date fails" check can live
Base: 22188c54
Verified: `grep -n expiredFlags -r . --include=*.ts` (excluding node_modules) -> `packages/core/src/features.test.ts:160: const lines = expiredFlags(featureFlags, today).map(`
Unknowns: none. I did not run `bun test`, so the existing test's pass at today's date is read from the dates, not run.

1. `packages/core/src/features.ts:249` — `expiredFlags(registry, today)` returns the keys (`string[]`) of flags whose `removeBy < today`, compared as strings. A flag whose date equals today is not expired. — observed
2. Production code has no caller. The only caller is `packages/core/src/features.test.ts:158`, the test "no registry flag is past its remove-by date". It calls `expiredFlags(featureFlags, new Date().toISOString().slice(0,10))` and expects `[]`. Failure lines read `flag <key> is past its remove-by date <date>: open a cleanup ticket`. Finding 6 says "nothing in CI … calls it", which is wrong, because the test is the caller. — observed
3. The comment at `features.ts:2` promises each flag has a "remove-by date". The comment at `features.ts:10` says "After this day the flag is a cleanup ticket." That promise has no mechanism except the test in item 2. — observed
4. Flag dates: 23 flags have `removeBy: "2027-03-01"` and 13 have `"2027-06-01"`. No flag is past 2026-11-20. No flag falls within 30 days, up to 2026-12-20. The earliest date is 2027-03-01. — observed
5. Where a check can live, and how it behaves for an expired flag:
   - The `test:unit` script in `package.json:15` includes `packages/core`, so `features.test.ts` already runs. CI runs `bun run test:unit` (`.github/workflows/ci.yml:59`), so the existing check already sits in CI.
   - `bun run lint` is `eslint .` (`package.json:19`). `tools/eslint-rules` holds only `index.js` and `no-time-literals.js`, and the repo has no `*.scan.test.ts`. A lint-based check would need a new rule, which is the "call it from lint" option in the finding.
   - An expired flag fails the existing test. It would then fail the `test:unit` step in CI and break `master` CI. The failure starts on the first run after 2027-03-01 (the check is `removeBy < today`), with no code change. The test uses the real clock (`new Date()`), so it is time-dependent. — observed

Checks: `features.test.ts` "no registry flag is past its remove-by date" covers the expired-flag failure through CI `test:unit`; it misses a warning window before the date (30 days) and any operator-console surface.

