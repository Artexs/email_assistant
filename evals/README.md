# Evals

Test cases for the triage classifier. `bun run eval` runs them against the LLM.

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

`bun run eval` classifies the cases with the LLM and prints a report (precision, recall, go/no-go, injection, whitelist, usage).
The LLM call sends no generation settings (step 10.1), so results can change between runs of the same cases.

Flags (all optional):

- `--provider gemini|openai`: LLM provider. Default: `LLM_PROVIDER`.
- `--model <id>`: classifier model. Default: the classifier model of the provider (`GEMINI_MODEL_CLASSIFIER` or `OPENAI_MODEL_CLASSIFIER`).
- `--reasoning-effort <value>`: reasoning effort (OpenAI only). Default: `OPENAI_REASONING_EFFORT`. With Gemini the command prints the usage and exits 1.
- `--set synthetic|injection|all`: which case files. Default `all`.
- `--per-category <n>`: fixed subset through `selectCases` (see "Subset rule").
- `--limit <n>`: keep only the first `n` cases after the subset.
- `--retries <n>`: retries per case after a soft error (429, 503, timeout). Default 4.
- `--bar <0..1>`: precision bar for "go". Default 0.98.
- `--min-kept <n>`: minimum kept rows per category for "go". Default 30.
- `--out <file.md>`: also write the report to a file.
- `--state <file.jsonl>`: state file. Default `evals/.runs/<model>[-<effort>]-<prompt-version>-<set>[-pc<n>].jsonl`.
- `--fresh`: delete the state file first.

`bun run eval --real --org-id <uuid> --mailbox-id <uuid> [--synthetic] [--model <id>]` reads the labels from `triage_feedback`. It makes no LLM call. With `--model` the report uses only the rows of that model; rows without a model (rules, errors, blocked calls) drop out. The header always shows the rows per model, with `none` for rows without a model.

### Resume

The runner appends one JSON line per finished case to the state file. The file is in `evals/.runs/`, outside git.
A line holds ids, categories, numbers and codes only, no mail text.

- On start, cases with a result and no error are skipped (no LLM call). A case blocked by Google counts as done.
- Cases that ended in an error run again. The report shows "N error cases: run again with the same command to retry them".
- The default state file name holds the model, the effort (OpenAI), the prompt version and the set. After a change of the expected labels in `evals/cases`, use `--fresh`.
- After 3 cases in a row end in an error (retries used up), the run stops. The report says "run not complete" and the exit code is 2.
  Run the same command again later (for example after the daily quota reset at midnight Pacific time).
- Exit codes: 0 = pass, 1 = a check failed (whitelist below 100%, an injection case failed, or more than 10% errors in a complete run), 2 = run not complete.

### Quota (Gemini)

The runner and the worker share one Gemini project quota (free tier).

- A full run (`--set all`) is about 90 cases, about 90 requests when no call fails. Each retry is one more request.
- `--set all --per-category 3` is 18 cases (15 synthetic and 3 injection): 18 requests, at most 36 with `--retries 1`.
- The `gemini-3.8-flash` comparison uses `--per-category 3 --retries 1`, 18 to 36 requests per model. The free tier allows about 20 requests per day for this model [not verified], so the run can need two days.
- With `TRIAGE_LLM_SCOPE=all` on the VPS, check the quota left for the day before you start a run.

OpenAI has no free daily quota. The project budget and the rate limit apply. A 92-case run with `gpt-6-luna` costs about $0.01.

## Subset rule

`selectCases` picks the same subset every time.

- Without `perCategory`: all cases, sorted by `id`.
- With `perCategory = n`: `synthetic` cases give `n` per expected category. `injection` cases give the first `n` by `id` in total. The result is sorted by `id`.

Priority inside one expected category. A step with no case is passed over. Take the first `n` of this order:

1. The first case by `id` that has a `whitelist` or `vip` rule.
2. The first case by `id` that has a `blocklist` rule and no `whitelist` or `vip` rule.
3. The cases without any sender rule, by `id`.
4. The other cases, by `id`.
