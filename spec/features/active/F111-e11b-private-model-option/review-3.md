# F111 stage 03 review (Opus, job 2026-11-15-f111-review-s03-opus-endpoint-in-9ebac582)

Verdict: PASS 88f9cc62. No blocking finding. Landed with --keep-open.

## Test gaps (judged acceptable)
- TG1: the gate-evidence reader matches the prompt version and the endpoint, not the model. This is by design (D13). F110 must add the model match and re-gate `auto` on a switch (docs/capabilities/triage.md rule 16).
- TG2: the error row is tested with one code (`http_503`). One writer (`service.ts:530`) serves every code. Accepted.

## Notes
- N1: `OPENAI_CUSTOM_HEADERS` with an `Authorization` line removes the bearer key (nulls come after the auth headers in the SDK merge). The failure is closed (401), but unclear. Add one docs line (stage 06 guide or `docs/capabilities/triage.md`).
- N3 (F113): `lab/start.ts:97` checks an unpriced model at the standard rate. An own endpoint with an unpriced model is refused (`model_unpriced`: safe, wrong). An eu endpoint with only a standard row passes the start and counts $0 toward the lab cap. F113 must pass the endpoint to the start check (stage 11 serve/start).
- N4: an eu run with the UNVERIFIED row runs at 1.10x the standard cap. The `runSim` run line does not print the UNVERIFIED mark (report and `triage:cost` do). Small improvement later.
- N6: `listUsageSince` (CLI only) has no `email_id` index and no time bound on the `audit_log` subquery. Fine at pilot volume.
- N7: `triage:cost` prints USD with 6 decimals (was 4).
- Header null trick verified on openai SDK 7.53.0 (bun.lock): works, no case problem.
