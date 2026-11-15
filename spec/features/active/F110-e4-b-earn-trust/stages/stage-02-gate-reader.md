# F110 stage 02 — Gate-file reader

Part of [`../plan.md`](../plan.md).

## Step 1 — Read the gate files at start

- **Goal:** the server knows the global evidence of the running classifier key (D1, D2, P9).
- **Files:** new `apps/server/src/modules/triage/evidence.ts`; `deploy/Dockerfile` (add `COPY evals/results/gate evals/results/gate`); `main.ts` wiring; config key `GATE_EVIDENCE_DIR` (default: `evals/results/gate` from the repo root, as the eval scripts resolve it).
- **Interfaces:** `loadGateEvidence(dir): GateIndex`, `runningEvidenceKey(llm, promptVersion): EvidenceKey`, `globalEvidenceFor(index, key): Record<BarCategory, GlobalEvidence>` ([interfaces.md](../interfaces.md)). Parse each file with the existing `gateFileSchema` (`eval-sim-report.ts`). A file without `endpoint` is `standard` with `host` null (`docs/capabilities/triage.md` rule 16); a file without `promptParts` has none. The running key takes `reasoningEffort` from the classifier role row (`null` when the provider has none, also for `own`), `promptParts` from the production prompt choice (`triage/prompts/index.ts`), and `host` from the checked endpoint (`llm_settings` host).
- **Decisions:** D1, D2. Read only `classifier-*.json` files with `role: "classifier"`; skip other files with no warning (refresh 1: an `extractor` file of F116 has another schema; `escalation` files prove a cascade). A missing directory or a file that does not parse is not a start error: log one `warn` line with the file name and the count (no content), skip the file. `GlobalEvidence.cases` = the category `support`; `file` = the file name only.
- **Test** (`triage/evidence.test.ts`, fixture files in a temp folder):
  1. One file for `openai/gpt-6-luna/none/classifier-v2`, no `endpoint` key → matches the running key with `standard`; `info` = `go`, threshold 0.95, provisional true.
  2. Same file, running endpoint `eu` → every category `none`.
  3. Two files for one key, one provisional of 2026-11-14 and one non-provisional of 2026-11-10 → the non-provisional wins.
  4. Two non-provisional files, dates 11-10 and 11-14 → 11-14 wins.
  5. A file with another `promptVersion` or `reasoningEffort` → not matched.
  6. A broken JSON file next to a good one → the good one is read, one `warn` line, no throw.
  7. Missing directory → empty index, every category `none`.
  8. Two `own` files for one model, hosts `llm-a` and `llm-b`; running host `llm-b` → the `llm-b` file (review 1 B4).
  9. A file with `promptParts: ["folder_hint"]`, running prompt with no parts → not matched.
  10. An `extractor-*.json` file and a `role: "escalation"` file next to a good one → skipped, no `warn` line.
- **Check:** `bun test apps/server/src/modules/triage/evidence.test.ts`

## Step 2 — Keep the real file readable in CI

- **Goal:** a test fails when the committed gate files stop parsing for the runtime reader.
- **Test:** extend `gate-evidence.test.ts` (or a new unit test next to it): `loadGateEvidence("evals/results/gate")` reads every committed classifier file with no warning (three files at `17b2a369`: classifier v2 and v3, extractor v1); the key of `classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json` is `openai/gpt-6-luna/none/classifier-v2/standard`.
- **Check:** `bun test apps/server/src/modules/triage/gate-evidence.test.ts`

## Done when

- The index is built once at start and passed through the deps that later stages use (`SettingsDeps` or the triage deps; one place, named in your final message).
- A `docker build` is not run here; the `COPY` line is reviewed by reading the Dockerfile. The image build runs in stage 26.
- Proof (`s02`) prints `PROOF_OK`.

## Out of scope

Any use of the evidence in the gate or the triage (stage 04).
