---
opened: 2026-11-13
---

# F089 · Logs are events with allow-listed fields and run ids, with a lint rule in warn mode

## Outcome

The server writes one JSON object per log line with a constant `event` code, allow-listed fields (ids, codes, counts, durations) and the `job`, `run_id` and `request_id` of the context, so one run can be followed from its first line to its last. A lint rule warns on the old free-text form, so every new Stage 2 log line is an event from its first stage. The conversion of the existing 409 calls runs module by module in E8a, which turns the rule to error (ADR 0024 points 1–3).

## Scope

- Starting seam: `apps/server/src/platform/log.ts`, `platform/scheduler.ts` (a context per job tick), `platform/http.ts` (a context per request, the `request_id` response header), `main.ts`.
- `LOG_FORMAT=json|text` (text in dev, json default on the VPS), `LOG_LEVEL` as today.
- The allow-list of field names and value shapes; a writer that drops anything else and counts the drops.
- The lint rule (warn): a template literal or a string with `${` as the first argument of `log.*`.
- Conversion of `platform/` and `main.ts` as the proof (28 calls); the modules stay as they are until E8a.

## Out of scope

- The log store, rotation, alerts, the canary test (E8a, E8b). The conversion of the modules (E8a).

## Acceptance

- With `LOG_FORMAT=json`, `bun run start` writes one JSON object per line with `time`, `level`, `module`, `event`, `msg` and only allow-listed fields.
- A unit test proves that an unknown field and a long string value are dropped and counted.
- A job tick and an HTTP request carry `run_id` or `request_id` in every line of their context (integration test over one triage run and one `/api/me` request); the response has the `x-request-id` header.
- `bun run lint` warns on `log.info(\`…${x}…\`)` and passes on `log.info("event_code", { … })`; a fixture proves both.
- `LOG_FORMAT=text` prints the readable form `[module] event key=value …`.
- `docs/code-patterns.md` and the styleguide state the log standard; ADR 0024 points 1–3 are marked landed.

## Notes

Design and stages: [plan.md](plan.md). Source: ADR 0024, PD-051, review §3.11.
