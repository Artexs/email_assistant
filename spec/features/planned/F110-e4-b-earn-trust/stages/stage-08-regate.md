# F110 stage 08 — Re-gate on a model or endpoint switch `[risky]`

Part of [`../plan.md`](../plan.md). Risk: mail moves without the user under a model that has no evidence (rule 16, P9). Always on: no flag.

## Step 1 — The re-gate run

- **Goal:** after a switch, `auto` stays on only where the new key has evidence; the user gets one notice per paused category (D7, D8).
- **Files:** `trust/regate.ts`; `main.ts` runs it once at start, before the triage worker and the action committer are registered (a `ready` move planned under the old key must meet the new policy, review 1 T2), and then as job `trust.regate` every 5 min (a config change needs a restart, so the start run is the main one; the job covers a crash in the start run).
- **Interfaces:** `regateAll(deps, now): Promise<{ stamped: number; regranted: number; paused: number }>`.
- **Decisions:**
  - For every mailbox of every org that is not `suspended`, for each category with `auto: true`:
    - no `grant` → write the grant with the running key, `by: "legacy"` (one audit row per mailbox; the deploy changes no behaviour, D7);
    - grant key = running key, `by` is `evidence`, `recommended` or `regate`, and the global evidence of the key is no longer a non-provisional `go` (a newer gate file in this release) → pause as below with reason `evidence_changed` (review 1 N2); else nothing. `legacy` and `forced` grants skip this check;
    - grant key ≠ running key and `by` is not `forced`, and `autoEvidence` under the running key is eligible → new grant `by: "regate"` (audit row with old and new key);
    - else → `auto: false` (through `setCategoryAuto`, audit `field: auto.<cat>`, `data.reason: "model_switch"`), and in the same transaction `insertTrip` with reason `model_switch` and `granted_at` = the old grant `at`, and `queueTrustNotice(autonomy_paused)` (stage 10).
  - The run uses `autoEvidence` for every org, with or without `trust_ladder` (global evidence belongs to the model, not to the flag; review 1 N5).
  - After a pause or a re-grant on a mailbox: `queueHistoryCheck(..., "model_switch")` when `trust_ladder` is on (the history result belongs to the old key; a stale `fail` still blocks, D8).
  - Each mailbox in its own transaction under the settings share-lock pattern of `saveTriage` (M13); the settings version moves, so a triage batch that read the old settings writes nothing (`triage.md` rule 9).
  - Two processes at once: the second sees the new grant or `auto: false` and does nothing (the trip unique key stops a second notice).
- **Test** (`apps/server/test/integration/trust-regate.test.ts`, fixture gate index):
  1. Legacy `auto` on `notification`, no grant → after the run: grant `legacy` with the running key; `move` still `ready` in the next triage.
  2. Grant on key A (standard), running key A with endpoint `eu`, no `eu` gate file → `auto` off, one trip `model_switch`, one outbox row per linked owner, one history check queued (flag on).
  3. Grant on key A, running key B with a non-provisional `go` file for B → grant `regate`, `auto` stays on, no notice.
  4. A `forced` grant on key A, running key B with `go` → paused (forced grants are never re-granted).
  5. Two runs at once → one trip row, one notice per owner.
  6. A triage batch that read the settings before the pause → saves nothing; the next batch logs the `move`.
  7. A suspended org → untouched.
  8. Grant `evidence` on key A; the index for key A now picks a newer non-provisional `no-go` file → paused, trip `evidence_changed`.
  9. A `ready` `move` of `notification` planned under key A; start on key B with no B file → the start run ends before the committer runs; the action is never `applied` (it ends as the committer's policy re-check decides, `expired` / `policy_changed` at `HEAD`).
- **Check:** `bun test apps/server/test/integration/trust-regate.test.ts`

## Done when

- `regateAll` logs one `info` event `trust_regate_done` with the count fields `stamped`, `regranted`, `paused` (`platform/log-fields.ts`); stage 26 reads it.
- The guard check of `spec/build.md` TRACK is in the final message.
- Proof (`s08`) prints `PROOF_OK`.

## Out of scope

The tripwire on corrections (stage 09). A re-run of the global eval (E2a tooling).
