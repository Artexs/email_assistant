# s1b-shadow-triage — Stage 26

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 26 — Feedback and labeling CLI

- [ ] **26.1 `recordFeedback` and `listForLabeling`**
  - Goal: one entry point that writes a feedback row for a triaged email, and one list for the labeling CLI with the summary.
  - Files: create `apps/server/src/modules/triage/feedback.ts`; export from `triage/index.ts`; create `apps/server/test/integration/triage-feedback.test.ts`.
  - Interfaces:
    - `recordFeedback(db, ctx, input: { emailId: string; trueCategory?: Category; verdict?: "right" | "wrong"; source: FeedbackSource; userId?: string }): Promise<{ id: string; verdict: "right" | "wrong" }>` (`FeedbackSource` from `@ea/core`, step 1.1, review finding 14).
    - `interface LabelItem { emailId: string; receivedAt: Date; from: string | null; subject: string | null; category: Category; confidence: number; modelCategory: Category | null; summary: string | null }`.
    - `listForLabeling(db, ctx, mailboxId, opts: { limit: number; mail: MailKind }): Promise<LabelItem[]>` — `listUnlabeled` (step 8.1) plus `listSummaries` (actions index, step 6.1) for the summary; `modelCategory` from `fields.model_category`.
  - Decisions: every feedback source writes through `recordFeedback` (architecture §4.4). The email must have a `triage_results` row in the same org, else `HardError("email has no triage result")`. With `trueCategory`: verdict = `right` when it equals the latest result category, else `wrong`. With only `verdict`: store it with `true_category` NULL. Neither → `HardError`. A known mail is never triaged again because of feedback (no loop).
  - Test: right/wrong from `trueCategory`; verdict only; another org's email → error; no result → error; `listForLabeling` returns the summary of a `save_summary` action and `null` for a mail without one, and leaves out synthetic mail with `mail: "real"`.
  - Check: `bun run dev:up && bun run db:migrate && bun run lint && bun run typecheck && bun run test:int`
  - Done when: the tests pass.
  - Out of scope: Telegram buttons, Undo.

- [ ] **26.2 `bun run triage:label`**
  - Goal: the user labels triaged mail from the terminal.
  - Files: create `apps/server/src/modules/triage/label-input.ts`, `apps/server/src/modules/triage/label-input.test.ts`, `apps/server/src/scripts/triage-label.ts`; export `parseLabelInput` from `triage/index.ts`; change root `package.json` (`"triage:label": "bun apps/server/src/scripts/triage-label.ts"`).
  - Interfaces:
    - `bun run triage:label --org-id <uuid> --mailbox-id <uuid> [--limit 20] [--user-id <uuid>] [--synthetic]` (interactive); `bun run triage:label --org-id … --email-id <uuid> (--category <c> | --right | --wrong)` (one label, for scripts).
    - `parseLabelInput(input: string, predicted: Category): { kind: "right" } | { kind: "category"; category: Category } | { kind: "wrong" } | { kind: "skip" } | { kind: "quit" } | { kind: "ask_again"; message: string }`.
  - Decisions:
    - Style of the other scripts (`parseArgs`, Zod uuid checks, `loadConfig`, `assertAppRole`, exit codes). Errors: `log.error("failed:", describeError(error))`.
    - Interactive: `listForLabeling` (default `mail: "real"`; `--synthetic` lists synthetic mail, for dev checks). For each mail print the received time, sender, subject, predicted category, confidence, model category and summary. These lines go to stdout through a local helper `out(line)` = `process.stdout.write(\`${line}\n\`)`, never through `log`(review finding 17: log lines carry no mail data). Never print the body. Only the counts at the end ("labeled n, skipped n") go through`log.info`.
    - Input with Bun's global `prompt()` [not verified in Docker]. `parseLabelInput` rules: empty input (Enter) = right, but when `predicted` is `unsure` it returns `ask_again` with "unsure is not a label: type a category name or number, w, s or q" (review finding 17); a category name or its number (`1` urgent, `2` needs_reply, `3` info, `4` notification, `5` spam) = true category; `w` = wrong without a category; `s` = skip; `q` = quit; anything else = `ask_again`. Only these 5 categories are offered (not `delegation`, not `unsure`). Feedback source `cli`.
    - On the VPS the command runs as `$C run --rm server bun run triage:label …` without `-T`, so the container has a TTY for `prompt()`.
  - Test (`label-input.test.ts`): Enter on `info` → right; Enter on `unsure` → `ask_again`; `3` → `info`; `spam` → `spam`; `w`, `s`, `q`; `x` → `ask_again`; `delegation` → `ask_again`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`. Manual run on the dev DB: seed GreenMail (`TEST_MAILBOX_ADDRESS=<GreenMail mailbox address> bun run mailbox:seed … --count 2`), start the server once with `TRIAGE_LLM_SCOPE=synthetic` (about 2 free-tier requests) until the mails are `triaged`, then `bun run triage:label --org-id … --mailbox-id … --synthetic` and label one mail.
  - Done when: the tests pass and a manual run writes a `triage_feedback` row with source `cli`.
  - Out of scope: a web or Telegram labeling UI.
