# Stage 10 split log

Base commit before the history merges: `57d52e8ef844239cfff8330cf542105969e4fb8a`. Int env: `EA_TEST_WORKER_DB=1`, `--timeout=30000`. Before runs: 98 pass (notices), 32 pass (commands), no failure.

## apps/server/test/integration/channels-notices.test.ts

- Old lines: 2730 (800+; split).
- Parts: `channels-notices-urgent.test.ts` 377, `-mailbox` 505, `-action-failed` 423, `-approval` 308, `-send-result` 463, `-send-held` 281, `-sent-missing` 451; helpers `channels-notices-helpers.ts` 173.
- Proof: `split-proof PASS cases=98` (each part run in its own process; no `assertions` line).
- Setup list (old file, top level) and where it went:
  - `db` and `afterAll` (destroy): repeated in every part.
  - `T`, `at`, `Org`, `org`, `run`, `setStatus`, `rows`, `APPLIED`, `SENDER`, `BODY`, `SendOrg`, `sendOrg`, `Pair`, `waiting`, `sendState`, `buttonData`, `finishSend`, `ended`: helpers file (two or more parts use them).
  - `resultText`: `-send-result` only. `setOAuthError`: `-mailbox` only.
  - `errorLines`, `logSpy`, `errorSpy` and the `beforeEach`/`afterEach` spies: repeated in `-urgent`, `-mailbox`, `-approval`, `-send-held`, `-sent-missing` (they read `errorLines`). `-action-failed` and `-send-result` keep the same two spies without `errorLines` (they never read it); both console methods stay silent as before.
- Assertion lines: none.
- A `describe` name that carries a plan code in the old file ("after a resume (D4)") keeps its name in `-action-failed`: a case keeps its path and name.
- References repointed: `docs/capabilities/digest-and-notices.md` (test list, line 183), `docs/code-patterns.md` (step 4 of the notice checklist).

## apps/server/test/integration/channels-commands.test.ts

- Old lines: 832 (800+; split).
- Parts: `channels-commands-status.test.ts` 387 (helpMessage, statusMessage), `channels-commands-pause.test.ts` 407 (digestNowMessage, pause and resume, suspended organization, runCommand); helpers `channels-commands-helpers.ts` 67.
- Proof: `split-proof PASS cases=32` (no `assertions` line).
- Setup list: `db` and `afterAll`: repeated in both parts. `T`, `MIN`, `at`, `utc`, `depsAt`, `llmCall`, `setup`: helpers file. No other hooks or mocks.
- References repointed: `docs/capabilities/digest-and-notices.md` (test list, line 183).

## Reference checks

`bun test apps/server/src/capability-map.test.ts apps/server/src/legal-papers.test.ts apps/server/src/bare-codes.test.ts apps/docs/src/security/claims.test.ts apps/server/src/modules/actions/transitions.test.ts`: 106 pass, 0 fail.
