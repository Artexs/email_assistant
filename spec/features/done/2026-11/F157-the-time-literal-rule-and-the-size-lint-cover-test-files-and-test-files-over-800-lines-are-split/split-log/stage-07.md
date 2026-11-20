# Stage 07 split log

Stage base: `73801f3e` (the merge of the stage 01 branch). Both files were over 800 lines there, so both were split.

## `apps/server/src/platform/config.test.ts` (942 lines)

Before: 119 cases, all pass (`bun test --reporter=junit`).

| Part | Lines | Top-level describes |
| --- | --- | --- |
| `config-load.test.ts` | 318 | `loadConfig` |
| `config-channels.test.ts` | 250 | `TELEGRAM_API_ROOT`, `SEND_SCOPE`, `loadTestmailConfig`, `web keys`, `auth mail settings` |
| `config-flags.test.ts` | 216 | `FEATURES_OFF`, `MAIL_TRUSTED_AUTHSERV_IDS`, `OPERATOR_USER_IDS`, `LOG_FORMAT`, `EA_RELEASE`, `send limits`, `mailSyncCron`, mailbox OAuth keys, `OPERATOR_LOCALE` |
| `config-slo-vapid.test.ts` | 156 | `SLO thresholds`, `VAPID keys` |
| `config.test-helper.ts` | 22 | helpers |

Proof: `split-proof PASS cases=119` (each part ran in its own `bun test`: 40, 43, 28, 8 cases).

Setup list (top-level statements that are not imports, `describe` or `test`):

- `fullEnv`, `geminiEnv`, `configError`: used by two or more parts, so they moved once to `config.test-helper.ts` (exported). No hook, mock or fake timer exists in the file.

Assertion lines: none.

References repointed: none found (`git grep` for `config.test.ts` finds only the history sentence in `scripts/test-audit/README.md`, reworded to name no path).

## `apps/server/src/modules/triage/eval.test.ts` (997 lines)

Before: 65 cases, all pass.

| Part | Lines | Top-level describes |
| --- | --- | --- |
| `eval-run.test.ts` | 486 | `runEval` |
| `eval-worker-pool.test.ts` | 211 | `runEval worker pool` |
| `eval-log-state.test.ts` | 167 | `eval log lines`, `evalStateFileName` |
| `eval.test-helper.ts` | 154 | helpers |

Proof: `split-proof PASS cases=65` (parts ran alone: 38, 13, 14 cases).

Setup list:

- `usage`, `Step`, `Recorded`, `answer`, `fakeLlm`, `makeCase`, `anna`, `marek`, `delegationAnswer`, `delegationCase`, `harness`, `opts`, `soft`, `delayedLlm`, `idCases`, `fixedCost`: moved to `eval.test-helper.ts` (exported). Some are used by one part only; they stay together there because `answer`, `makeCase` and `usage` feed the others.
- `beforeEach` / `afterEach` with `spyOn` (the `eval log lines` describe): stay in `eval-log-state.test.ts` with that describe.
- No `mock.module` and no `setSystemTime`.

Assertion lines: none.

References repointed: `docs/capabilities/triage.md` (the test list names the three parts, not the old file).

## Reference checks

`bun test apps/server/src/capability-map.test.ts apps/server/src/legal-papers.test.ts apps/server/src/bare-codes.test.ts apps/docs/src/security/claims.test.ts apps/server/src/modules/actions/transitions.test.ts`: 106 pass, 0 fail.
