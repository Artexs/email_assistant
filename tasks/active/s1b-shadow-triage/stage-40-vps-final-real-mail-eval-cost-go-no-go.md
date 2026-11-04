# s1b-shadow-triage — Stage 40

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.
Shell setup, preconditions and the SQL queries (Q1–QH) are in [`vps-shared.md`](vps-shared.md).

## Stage 40 — VPS: final real-mail eval, cost, go/no-go [risky]

- [ ] **40.1 `eval --real`, `triage:cost`, final table**
  - Goal: the real-mail done-when items pass, and the final go/no-go table and the cost are in this file.
  - Files: this task file ("Results", log lines, done-when ticks).
  - Interfaces: none (operations).
  - Decisions: the final table counts only real mail (`--real`, step 28.1). Rule rows (blocklist) and `triage_error` rows are reported on their own lines, not in the LLM precision (review finding 18).
  - Steps:
    1. `$C run --rm -T server bun run eval --real --org-id <ORG> --mailbox-id <MB>` (stdout; numbers and categories only).
    2. `$C run --rm -T server bun run triage:cost --org-id <ORG> --mailbox-id <MB> --days 7` (real mail).
    3. Copy into "Results": the final go/no-go table (threshold, precision, recall, kept, decision per category; minimum support 30; `no-go: too few` where kept < 30), the per-category thresholds (the `go` threshold, else "none"), the rule and error lines, the confidence histogram per category, the cost per mail and per mailbox per month (paid-tier price, source URL and date), and the label count with the rule that applies (≥ 100, or all real pilot INBOX mail of the last 30 days).
    4. Tick the done-when items, each with its command and output in the log.
  - Test: none (operations).
  - Check: the report header N equals QB; `eval --real` exits 0; `triage:cost` prints a figure per model.
  - Done when: the real-mail done-when items pass (labels as above, one week, tokens and latency stored, cost per mailbox per month computed).
  - Out of scope: changes to `mailbox_settings` (thresholds and automatic moves belong to S3), a prompt change.
