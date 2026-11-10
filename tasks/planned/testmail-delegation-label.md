> **Status 2026-11-10 — planned.** Idea from `test-mail-traffic` stage 9; not started.

# Testmail: `delegation` as an expected category

Scope: test tooling (`packages/core/src/testmail/`, `evals/testmail/README.md`). Needs: nothing.

## Goal

A batch case can expect `delegation`, so `compare` stops counting a correct `delegation` result as WRONG when delegates are active on the VPS.

## Why

The smoke mail `anna-termin-dostawy` (2026-11-09) got `delegation` 0.84 with 1 active delegate; `compare` counted it WRONG (task `tasks/done/test-mail-traffic.md` § Results).
The batch schema allows only the 5 classifier categories without delegates.

## Done when

- The batch schema accepts `delegation` (only when the batch says delegates are active), the checker prompt and the runbook mix name it, and `compare` scores it.
- Tests cover the new label in `validateBatch` and in the compare report.
