# Static scan summary

Total rows: 11650 (one per test or it call site).

## Rows per kind

| kind | rows |
| --- | --- |
| unit | 5856 |
| int | 5569 |
| e2e | 225 |

## Rows per area

| area | rows | unit | int | e2e |
| --- | --- | --- | --- | --- |
| packages/core | 2097 | 2097 | 0 | 0 |
| apps/server/src | 2394 | 2394 | 0 | 0 |
| apps/server/test | 5550 | 0 | 5550 | 0 |
| apps/web/src | 869 | 869 | 0 | 0 |
| apps/web/integrations | 19 | 19 | 0 | 0 |
| apps/web/e2e | 217 | 0 | 0 | 217 |
| apps/docs | 308 | 300 | 0 | 8 |
| deploy/test | 87 | 87 | 0 | 0 |
| tools/fake-telegram | 86 | 67 | 19 | 0 |
| tools/mail-oauth-spike | 23 | 23 | 0 | 0 |

## Flags per area

| area | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | flagged rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packages/core | 0 | 2 | 0 | 0 | 8 | 81 | 0 | 0 | 91 |
| apps/server/src | 4 | 10 | 2 | 1 | 5 | 48 | 0 | 75 | 145 |
| apps/server/test | 3 | 2 | 0 | 0 | 1 | 9 | 3 | 79 | 96 |
| apps/web/src | 0 | 0 | 0 | 0 | 2 | 3 | 0 | 3 | 8 |
| apps/web/integrations | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 5 | 6 |
| apps/web/e2e | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| apps/docs | 0 | 1 | 0 | 0 | 0 | 10 | 0 | 30 | 41 |
| deploy/test | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 29 | 29 |
| tools/fake-telegram | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 17 | 18 |
| tools/mail-oauth-spike | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 23 | 23 |
| all | 8 | 16 | 2 | 1 | 16 | 151 | 3 | 261 | 457 |

Areas with more than 150 flagged rows: none.

## Groups

B groups (same body): 6, holding 16 cases.
T groups (same shape, one file): 37, holding 151 cases.

### The 20 biggest groups

| group | cases | files | first key |
| --- | --- | --- | --- |
| T10 | 10 | 1 | apps/server/src/platform/log-lint.test.ts:165 |
| B6 | 6 | 2 | packages/core/src/digest/callback-loop.test.ts:88 |
| T11 | 6 | 1 | apps/server/src/scripts/job-run-args.test.ts:12 |
| T36 | 6 | 1 | packages/core/src/web/csp.test.ts:28 |
| T5 | 6 | 1 | apps/server/src/modules/borders.test.ts:21 |
| T8 | 6 | 1 | apps/server/src/platform/log-lint.test.ts:28 |
| T25 | 5 | 1 | packages/core/src/metrics/week.test.ts:53 |
| T28 | 5 | 1 | packages/core/src/ops/alert-step.test.ts:43 |
| T29 | 5 | 1 | packages/core/src/outgoing/user-text.test.ts:6 |
| T30 | 5 | 1 | packages/core/src/replies/checks.test.ts:58 |
| T31 | 5 | 1 | packages/core/src/site.test.ts:6 |
| T9 | 5 | 1 | apps/server/src/platform/log-lint.test.ts:98 |
| T12 | 4 | 1 | apps/server/src/scripts/sim-compose-rules.test.ts:35 |
| T21 | 4 | 1 | packages/core/src/digest/local-time.test.ts:142 |
| T3 | 4 | 1 | apps/docs/src/in-place.test.ts:21 |
| T32 | 4 | 1 | packages/core/src/triage/cost.test.ts:6 |
| T33 | 4 | 1 | packages/core/src/triage/untrusted-text.test.ts:6 |
| T34 | 4 | 1 | packages/core/src/triage/untrusted-text.test.ts:17 |
| T37 | 4 | 1 | packages/core/src/web/errors.test.ts:19 |
| T6 | 4 | 1 | apps/server/src/modules/borders.test.ts:73 |

## Shared suite modules

- apps/server/test/contract/mail-provider.ts
- apps/server/test/contract/mail-sender.ts
