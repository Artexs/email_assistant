# F129 inventory — remove, merge, name

Stage 03 result. Reasons are in `stages/stage-03-inventory.md` (D13). Each row: decision, result, files and docs changed.

| Candidate | Decision | Result | Files and docs changed |
| --- | --- | --- | --- |
| `gemini:test` | remove | removed | `package.json`; `README.md`, `docs/roadmap.md`, `docs/architecture.md`, `docs/known-alerts.md` now name `bun run llm:check --provider gemini` (the stale `gemini-check.ts` name is `llm-check.ts`). The only other hit is the owner decision log `docs/owner-decisions.md` (the coordinator writes it). |
| `mailbox:probe-move`, `mailbox:probe-send` | merge into `mailbox-probe.ts` with `move`, `send`; keep both `package.json` names | merged | New `scripts/mailbox-probe.ts`, `mailbox-probe-args.ts` (one parser for both) with tests `mailbox-probe-args.test.ts`, `mailbox-probe.test.ts` (address guard, no connection opened). The two old entry files are gone. `package.json` names run `mailbox-probe.ts move` and `mailbox-probe.ts send`. Prefixes `[mailbox-probe-move]` and `[mailbox-probe-send]`, texts and exit codes stay. Callers: `mail-hosts-configured.test.ts`, `test/integration/mailbox-cli-streams.test.ts`; docs `capabilities/actions-and-undo.md`, `capabilities/drafts-and-send.md`. |
| `testmail:setup/validate/blind/send/status`, `testmail:target`, `testmail:remote`, the `testmail` module | keep | kept | none. Its move to `tools/` belongs to the AgentMail replacement (`docs/product/stage-2/06-architecture-review.md` § 3.17). |
| `triage:cost` | keep | kept | none. |
| `org:invite` vs `web:invite` | keep both | kept | none. |
| `mailbox:seed` vs `testmail:send` | keep both | kept | none. |
| `mailbox:check --probe` | keep | kept | none. |
| Four path-only entries | name | named | `package.json`: `e2e:job-env`, `e2e:activity`, `e2e:suggestions`, `demo:org-setup`. Callers by path stay. |
