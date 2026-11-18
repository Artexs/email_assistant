# F130: removal of the escalation cascade (quality pass 1, finding 2)

Ticket: `spec/features/active/F130-the-escalation-cascade-code-its-role-and-its-keys-are-removed-from-production-quality-pass-1-finding-2/ticket.md`.
Kept on purpose: `evals/results/2026-11-15-f109-escalation-summary.md`, `evals/results/f109-escalation/*`, the owner decision
"F109 escalation cascade: no ship by the cost rule" in `docs/owner-decisions.md`, and the price row `gpt-6.1-terra` in
`packages/core/src/triage/cost.ts` (price data, comment updated). `classifier-v3` was not touched (finding 3 is an owner item).

## References found by grep (before the delete)

Removed code:

- `apps/server/src/modules/triage/classifier.ts` (`escalateEmail`), `triage/index.ts` (export), `triage/prompts/escalation-v1.ts`, `triage/prompts/index.ts` (`prompts.escalation`).
- `packages/core/src/triage/escalation.ts` (`shouldEscalate`, `escalationRecord`, `EscalationSignals`) and its test; `packages/core/src/triage/index.ts` export.
- `apps/server/src/modules/triage/eval-escalation.ts` and its test (also `headerOf`, `missesOf`, `summarizeEscalation`).
- `apps/server/src/modules/triage/eval.ts` (`--escalate` branches, `escalateWithRetry`, `escalation` fields of the case result and the report; the state-file schema drops the two fields, an old state line still parses because the zod object strips unknown keys).
- `eval-pool.ts` (`escalationUsage` in the cost), `eval-report.ts` (`## Escalation` section), `eval-sim-report.ts` (`gateIdentityOf` role switch), `eval-failure-line.ts` (`stage`), `scripts/eval-args.ts` (`--escalate`, `--escalation-model`, `--escalation-reasoning-effort`), `scripts/eval-sim.ts` (escalation row, estimate, state-file name, gate name).
- `packages/core/src/llm-roles.ts` (role list), `apps/server/src/platform/config.ts` (`rowOf("escalation")`; the five keys come from `keyedRoles`, so they leave with the role), `platform/llm/settings.ts` (`uniformRoleTable`).
- Tests: `eval-escalation.test.ts`, `eval-sim-escalation.test.ts`, `escalation.test.ts` deleted; `eval-args.test.ts`, `eval-streams.test.ts`, `eval-report.test.ts`, `eval-sim-report.test.ts`, `evidence.test.ts`, `llm-roles.test.ts`, `cost.test.ts`, `rules-audit-repo.test.ts` (role `escalation` -> `extractor`) changed.

Removed keys: `LLM_ESCALATION_PROVIDER`, `_MODEL`, `_TIMEOUT_MS`, `_RPM`, `_REASONING` (`.env.example`; the config schema builds them from the role list).
Not found anywhere: `deploy/*` (compose, sim.env.example), `.github`, `package.json` (no eval script served only the cascade: `bun run eval` is shared).
F107 outside-services map (`apps/server/src/platform/outside-services.ts`): it lists only keys that end in `_URL`, `_HOST`, `_API_KEY`, `_TOKEN`, `_ENDPOINT`, `_API_ROOT`. No escalation key is in it, so it needs no change.

Docs changed: `docs/capabilities/triage.md` (rule 19 and every line that names the cascade; line 3 unchanged), `docs/architecture.md` §6.3, `docs/decisions/0015-llm-provider-switch.md` (role list), `docs/modules.md`, `evals/README.md`, `notes/2026-11-15-e3b-improve-results.md` (one line appended).
Left as history on purpose (name the cascade, no live key): `docs/diagrams/architecture-2026-11.*` (generated; the proof requires no diff), `docs/product/stage-2/*`, `docs/owner-decisions.md`, `evals/sim/lab-01/week/*/batch-012.json` (corpus text), `spec/features/{done,active}/*` (tickets, plans, reviews of F090, F100, F109, F107, F110, F111, F115, F116).

## Unknown env keys on the VPS

`configSchema` is `z.object({...}).superRefine(...)` with no `.strict()` and no `.passthrough()` (`apps/server/src/platform/config.ts`). Zod drops unknown keys, so
the five `LLM_ESCALATION_*` keys in the VPS `.env` are ignored and the server starts. Test: `config-roles.test.ts` test 11 (sets all five, with bad values too).
No deploy step is needed. The owner can delete the five lines from the VPS `.env` at any time.

## Same calls before and after

`apps/server/test/integration/triage-service.test.ts`, test "a person's mail that the removed cascade would have picked still makes one classifier call":
four answers (info, notification, spam, low-confidence info) from a person; each makes exactly one `generate` call, role `classifier`, prompt `classifier-v2`, one `llm.call` row.
The test passed on the base commit before any change (log in the job's log folder) and after.
