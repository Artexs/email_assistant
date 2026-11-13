# Stage 2 foundation group: state of the eight epics (2026-11-13, late evening)

Source: the architecture review that unified the repository (`docs/product/stage-2/06-architecture-review.md`), tickets F086 to F093 (commit `cb3a447`), order in `docs/product/stage-2/07-foundation-plan.md`. Each epic got a plan (a Limen feature folder with `plan.md` and `stages/`), a cold review of the plan, and then builds stage by stage. Every risky stage got an Opus review job before it landed.

## Summary

| Epic | Ticket | Stages | Landed | State |
| --- | --- | --- | --- | --- |
| Module borders | F086 | 5 | 5 | Closed |
| Feature flags | F087 | 6 | 6 | Closed |
| Notices as facts | F088 | 7 | 5 | Active: stage 06 running, stage 07 (docs) waits |
| Structured logs | F089 | 7 | 7 | Closed |
| LLM roles | F090 | 6 | 6 | Closed |
| Repo split | F091 | 5 | 0 | Plan landed, build waits for F088 |
| RLS safety net | F092 | 0 | 0 | No plan. Waits for the owner's yes to plan it |
| CI green | F093 | 3 | 3 | Closed |

Result: 5 of 8 epics closed (F086, F087, F089, F090, F093). One is active (F088). One has a plan and waits for its dependency (F091). One is not planned (F092).

Stages: 32 of 39 planned stages landed (F086 5, F087 6, F088 5 of 7, F089 7, F090 6, F093 3; F091 0 of 5; F092 has no plan).

## Per epic

### F086 module borders (closed, 5 stages)
1. `ExpireFilter` moved to core. 2. Retention keep rule from the composition root (risky, reviewed PASS). 3. `layers.json` and the generated border lint (reviewed PASS). 4. `bun run graph:modules` and the layers test. 5. Standards in code-patterns and the styleguide.
Effect: a deep import, a higher-layer import, a cycle or a forbidden type import fails the lint.

### F087 feature flags (closed, 6 stages)
1. Registry, resolver, `FEATURES_OFF`. 2. `org_features` migration and read path (risky, reviewed PASS). 3. `setOrgFeature` with audit row and `bun run org:flag`. 4. `OPERATOR_USER_IDS` and the operator guard (risky, reviewed PASS). 5. `GET /api/operator/flags` (risky, reviewed PASS). 6. Standards, ADR 0027.
Open owner steps (no longer a stop): `bun run db:migrate` on the dev DB; `org:flag` on the pilot org.

### F088 notices as facts (active, 7 stages, 5 landed)
1. Notice kinds and strict view schemas. 2. Renderer registry. 3. `outbox_view` migration, repo, sender (risky, reviewed PASS). 4. `queueNotice` and producers (reviewed PASS). 5. Queue stores no text; tap edit through the registry (risky, reviewed PASS). Checkpoint C1 group review: PASS (`spec/features/active/F088-notices-as-facts/review-group-c1.md`).
Running: stage 06 (detector registry; job `f088-stage-06-d791bd5d`). It also carries three fixes from the C1 review. Waiting: stage 07 (docs).
Known behaviour change, accepted: if a send succeeds and the DB write after it fails, a tap in the next 5 minutes gets the answer and no status edit.

### F089 structured logs (closed, 7 stages)
1. Writer with allow-listed fields (risky, reviewed PASS). 2. `LOG_FORMAT` and log context. 3. Run ids and request ids (reviewed PASS). 4. Lint rule in warn mode. 5. `platform/` converted (risky, reviewed PASS). 6. `main.ts` converted; lint at error for converted files. 7. Standards, ADR 0024, `jq` runbook.
Backlog (E8a): 395 old-form log calls still warn.

### F090 LLM roles (closed, 6 stages)
1. Role names and role table. 2. Role client (risky, reviewed PASS). 3. All callers on `generate`; old client gone (risky, reviewed PASS). 4. Audit rows with role; prompt registry (risky, reviewed PASS). 5. `llm:check --role`, role in eval reports. 6. Standards.
Open owner checks (no longer a stop): `bun run llm:check`, `bun run eval` against a real provider.

### F091 repo split (planned, 5 stages, 0 landed)
Plan landed with 13 review notes fixed. Builds after F088 and F090 are closed. F090 is closed; F088 is the only wait.

### F092 RLS safety net (not planned)
No plan, no stages. It waits for the owner's yes to plan it, and after F087 (closed).

### F093 CI green (closed, 3 stages)
Bun pin 1.3.14 and CI scripts, deterministic scheduler tests, rules. CI on `master` green.

## Related ticket opened by the coordinator
F094 (one Bun 1.4.4 for CI, image and VPS): plan landed; stage 1 built, reviewed PASS, CI green on a task branch; its land needs a conflict fix in `deploy/README.md` (job `f094-stage-1-risky-continue-c4b7070a`). Stage 2 is the VPS deploy.

## Follow-ups from reviews

See `notes/2026-11-13-s2-foundation-followups.md`.
