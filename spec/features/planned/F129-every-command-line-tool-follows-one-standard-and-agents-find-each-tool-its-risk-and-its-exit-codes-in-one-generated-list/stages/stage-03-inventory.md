# F129 stage 03 — Inventory: remove, merge, name

Needs: nothing new; it reads root `package.json`, `scripts/mailbox-probe-move.ts`, `mailbox-probe-send.ts` and the docs that name `gemini:test` at HEAD. May run next to 00 and 01. Stages 02 and 04 need its `package.json` names and the merged probe file.

Part of [`../plan.md`](../plan.md). Decisions: D10, D13.

## Decisions with reasons (D13)

| Candidate | Decision | Reason |
| --- | --- | --- |
| `gemini:test` | remove | alias of `llm:check --provider gemini`; F138, which was to remove it, is dropped |
| `mailbox:probe-move`, `mailbox:probe-send` | merge the files into `mailbox-probe.ts` with subcommands `move`, `send`; keep both `package.json` names (`bun …/mailbox-probe.ts move`) | same raw input, password on stdin, the `TEST_MAILBOX_ADDRESS` guard; they check different facts, so both commands stay |
| `testmail:setup/validate/blind/send/status`, `testmail:target`, `testmail:remote`, the `testmail` module | keep | only path that delivers real mail from outside the network; used 2026-11-14; its move to `tools/` belongs to the AgentMail replacement (`docs/product/stage-2/06-architecture-review.md` § 3.17) |
| `triage:cost` | keep | per-model tokens, latency and cost; M7 has none of it; they share only `costPerMail` and `llmPrices` |
| `org:invite` vs `web:invite` | keep both | new organization and owner vs a new setup link |
| `mailbox:seed` vs `testmail:send` | keep both | IMAP append vs real delivery |
| `mailbox:check --probe` | keep | probes a connected mailbox, not a raw host |

## Step 1 — Remove `gemini:test`

- **Files:** root `package.json`; `README.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/known-alerts.md` (each line becomes `bun run llm:check --provider gemini`; fix the stale `gemini-check.ts` name to `llm-check.ts`). Grep the whole repo outside `spec/` and `notes/` for `gemini:test`; `apps/server/src/platform/llm/provider-scan.test.ts` and `capability-map.test.ts` may name it.
- **Test:** `capability-map.test.ts` passes (it fails on a doc that names a missing script).
- **Done when:** `git grep -n "gemini:test" -- ':!spec' ':!notes'` prints nothing.

## Step 2 — Merge the probes

- **Files:** `scripts/mailbox-probe.ts` (new; the two old entries go), `mailbox-probe-args.ts` (+ test) with one parser for both subcommands, root `package.json`.
- **Decisions:** text and exit codes stay as the old files have them (the conversion to `runCli` is stage 07). The shared parts (args, stdin password, address guard) are one function each; the probe calls in `modules/mail/imap/` stay.
- **Test** (args unit test):
  1. `["move", "--host", "imap.example.test", "--port", "993", "--address", "probe@example.test"]` → `{ sub: "move", host, port: 993, address }`.
  2. `["send", …same…, "--smtp-host", "smtp.example.test", "--smtp-port", "465", "--to", "probe@example.test"]` → the send shape.
  3. `["move", "--smtp-host", "x"]` → usage error (send-only flag).
  4. `["drop"]` → usage error. 5. `--port 0` and `--port 70000` → usage error.
6. Integration: `mailbox-probe.ts move` with `--address other@example.test` while `TEST_MAILBOX_ADDRESS` differs → refused, exit as today, no connection opened.
- **Guard check:** remove the `TEST_MAILBOX_ADDRESS` check from the merged file → test 6 fails; restore. Name both runs in the final message.
- **Done when:** `imap-probe-move.test.ts` and `imap-probe-send.test.ts` pass; docs that name the old file paths name `mailbox-probe.ts`.

## Step 3 — Name the four path-only entries

- **Files:** root `package.json`: `"e2e:job-env": "bun apps/server/src/scripts/e2e-job-env.ts"`, `"e2e:activity"` → `e2e-activity.ts`, `"e2e:suggestions"` → `e2e-suggestions.ts`, `"demo:org-setup"` → `demo-org-setup.ts`.
- **Decisions:** callers by path (`scripts/limen-prepare.sh`, Playwright helpers, `docs-shots/global-setup.ts`) stay unchanged.
- **Done when:** each name runs its file (`bun run e2e:job-env` with bad args exits as the file does now).

## Step 4 — Report

- **Files:** `spec/features/planned/F129-…/inventory.md` (or the lane the ticket is in): the table above with a "Result" column (removed, merged, kept, named) and the files and docs changed per row.

## Out of scope

Moving `testmail` (follow-up, see `questions.md`); any `runCli` conversion; moving helpers.

## Done when

Steps 1–4 done; the plan.md Proof with `s03` prints `PROOF_OK`.
