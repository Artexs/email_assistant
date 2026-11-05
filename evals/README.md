# Evals

Test cases for the triage classifier. Stage 18 adds `bun run eval`.

## Files

- `cases/synthetic.json`: made-up mail with the expected category. Each case has `kind: "synthetic"`.
- `cases/injection.json`: mail that tries to steer the classifier. Each case has `kind: "injection"`.

A file is an array of cases. The schema is `evalCaseSchema` in `packages/core/src/triage/eval-case.ts`.
The structural test is `apps/server/src/modules/triage/eval-cases.test.ts`.

## Data rule

- Never put real mail in git (ADR 0007, architecture §9).
- Use made-up names and reserved domains only: `*.test`, `example.com`, `example.org`, `example.net`.
- The user's address in cases is `szef@firma.test`.
- `from` is a bare address or `Display Name <address>`. The address part is ASCII only. Polish letters go only in the display name.
- Sender rule patterns are in lower case.
- Real labels stay in the database (`triage_feedback`), never in git.

## Markers

- A borderline case has a `note` that starts with `borderline:`.
- An injection case has a `note` that starts with `attack:`.
- A whitelist/VIP case has a `whitelist` or `vip` rule that matches its `from` through `applyHardRules(splitAddress(from).address, senderRules)`.

## Time

`EVAL_RECEIVED_AT` is `2026-11-02T09:00:00Z` (a Monday). It is the `receivedAt` of every case.
"Today" in a case text means 2026-11-02.

## Run

`bun run eval` (stage 18). The LLM call sends no generation settings (step 10.1), so results can change between runs of the same cases.

## Subset rule

`selectCases` picks the same subset every time.

- Without `perCategory`: all cases, sorted by `id`.
- With `perCategory = n`: `synthetic` cases give `n` per expected category. `injection` cases give the first `n` by `id` in total. The result is sorted by `id`.

Priority inside one expected category. A step with no case is passed over. Take the first `n` of this order:

1. The first case by `id` that has a `whitelist` or `vip` rule.
2. The first case by `id` that has a `blocklist` rule and no `whitelist` or `vip` rule.
3. The cases without any sender rule, by `id`.
4. The other cases, by `id`.
