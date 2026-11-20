# Stage 18 log: the mail OAuth spike tests run in the unit suite

Groups G07 and G08 (both `FIX-NEVER-RUNS`). Owner answer: keep `tools/mail-oauth-spike/` and run its tests in `test:unit`. One commit: `F125 G07 FIX-NEVER-RUNS: oauth spike tests in test:unit`.

## Changes

- `package.json`: `tools/mail-oauth-spike` added to the `test:unit` path list.
- `scripts/check-job.sh`: the same path added to its copy of the unit list (the changed-tests run). No other copy exists (`rg "tools/llm-replay/src"`: the two files above, plus two imports in `apps/web/e2e/lib/demo/`).
- `tools/mail-oauth-spike/README.md`: one sentence: delete the path from `test:unit` and `check-job.sh` when the kit goes.
- No kit `.ts` file changed; no `bun.lock` change.

## Keys

`cut-keys.ts` on a fresh scan at the stage base: `keys 20: ok 20` (G07) and `keys 3: ok 3` (G08). Deferred: none. Rejected: none. Output: `/tmp/f125-s18/keys-g07.tsv`, `/tmp/f125-s18/keys-g08.tsv`.

| group | old key | new key | name |
| --- | --- | --- | --- |
| G07 | tools/mail-oauth-spike/probe.test.ts:54 | tools/mail-oauth-spike/probe.test.ts:54 | one bad row gives no file and exit 1, and nothing of it is shown |
| G07 | tools/mail-oauth-spike/probe.test.ts:71 | tools/mail-oauth-spike/probe.test.ts:71 | an evidence that is not a string counts as a bad row |
| G07 | tools/mail-oauth-spike/probe.test.ts:78 | tools/mail-oauth-spike/probe.test.ts:78 | good rows give the file with the documented shape; the owner address is masked |
| G07 | tools/mail-oauth-spike/probe.test.ts:99 | tools/mail-oauth-spike/probe.test.ts:99 | a row that throws is a FAIL row with codes only, and its message never reaches the file |
| G07 | tools/mail-oauth-spike/probe.test.ts:115 | tools/mail-oauth-spike/probe.test.ts:115 | refuses a wrong or missing state with 400, then stops after one good request |
| G07 | tools/mail-oauth-spike/probe.test.ts:201 | tools/mail-oauth-spike/probe.test.ts:201 | no token, code, state, client secret or address reaches the file or the screen; PKCE S256 binds the verifier |
| G07 | tools/mail-oauth-spike/probe.test.ts:267 | tools/mail-oauth-spike/probe.test.ts:267 | readEnv names the missing variables and never echoes a value |
| G07 | tools/mail-oauth-spike/probe.test.ts:287 | tools/mail-oauth-spike/probe.test.ts:287 | evidence that holds the exact value of a known secret is refused: no file, exit 1 |
| G07 | tools/mail-oauth-spike/probe.test.ts:323 | tools/mail-oauth-spike/probe.test.ts:323 | a short value is not a secret, and a clean row passes |
| G07 | tools/mail-oauth-spike/probe.test.ts:348 | tools/mail-oauth-spike/probe.test.ts:348 | every listener of the port is loopback, on both families, and they all answer |
| G07 | tools/mail-oauth-spike/probe.test.ts:367 | tools/mail-oauth-spike/probe.test.ts:367 | a port that another process holds on 127.0.0.1 or on ::1 stops the start |
| G07 | tools/mail-oauth-spike/probe.test.ts:498 | tools/mail-oauth-spike/probe.test.ts:498 | M10 sends to the To plus-address and the Bcc plus-address only |
| G07 | tools/mail-oauth-spike/probe.test.ts:514 | tools/mail-oauth-spike/probe.test.ts:514 | P1 sends to the To plus-address only |
| G07 | tools/mail-oauth-spike/probe.test.ts:527 | tools/mail-oauth-spike/probe.test.ts:527 | G5 sends over SMTP to the To plus-address only (RCPT TO and the headers) |
| G07 | tools/mail-oauth-spike/redact.test.ts:15 | tools/mail-oauth-spike/redact.test.ts:15 | refuses each token shape and an address |
| G07 | tools/mail-oauth-spike/redact.test.ts:31 | tools/mail-oauth-spike/redact.test.ts:31 | refuses a value that is not a string, and a string that is too long |
| G07 | tools/mail-oauth-spike/redact.test.ts:37 | tools/mail-oauth-spike/redact.test.ts:37 | the refusal names the rule and never holds the refused text |
| G07 | tools/mail-oauth-spike/redact.test.ts:48 | tools/mail-oauth-spike/redact.test.ts:48 | accepts the evidence a row writes |
| G07 | tools/mail-oauth-spike/redact.test.ts:66 | tools/mail-oauth-spike/redact.test.ts:66 | replaces a known address and its plus forms with <owner> |
| G07 | tools/mail-oauth-spike/redact.test.ts:73 | tools/mail-oauth-spike/redact.test.ts:73 | quotes a short plain word and hides everything else |
| G08 | tools/mail-oauth-spike/probe.test.ts:146 | tools/mail-oauth-spike/probe.test.ts:146 | the wait ends with an error at the timeout |
| G08 | tools/mail-oauth-spike/probe.test.ts:260 | tools/mail-oauth-spike/probe.test.ts:260 | parseArgs takes a provider and --out only |
| G08 | tools/mail-oauth-spike/probe.test.ts:410 | tools/mail-oauth-spike/probe.test.ts:410 | 100 folders and a 48-character folder name still give a result file with the special-use folders by name |

## Open branches

`limen/2026-11-19-f138-stage-02-remove-gemini-prov-e2edaabc` changes `package.json` (removes the `gemini:test` script, a different line from `test:unit`). The stage must change `package.json`; the two edits do not touch the same lines, so no conflict is expected. No open branch changes a kit file or `scripts/check-job.sh`.

## Spike run

`bun test tools/mail-oauth-spike` (log `/tmp/f125-s18/spike.log`): `23 pass`, `0 fail`, `138 expect() calls`, `Ran 23 tests across 2 files`. Case delta: the unit suite grows by 23. No lcov or mutant check (the cases never ran before).

