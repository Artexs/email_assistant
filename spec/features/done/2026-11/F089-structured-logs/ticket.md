---
opened: 2026-11-13
landed: 2026-11-13
---

# F089 · Logs are events with allow-listed fields and run ids, with a lint rule in warn mode

## Outcome

The server writes one JSON object per log line with a constant `event` code, allow-listed fields (ids, codes, counts, durations) and the `job`, `run_id` and `request_id` of the context, so one run can be followed from its first line to its last. A lint rule warns on the old free-text form, so every new Stage 2 log line is an event from its first stage. The conversion of the other module calls (about 380) runs module by module in E8a, which turns the rule to error (ADR 0024 points 1–2).

## Scope

- Starting seam: `apps/server/src/platform/log.ts`, `platform/scheduler.ts` (a context per job tick), `platform/http.ts` (a context per request, the `request_id` response header), `main.ts`.
- `LOG_FORMAT=json|text` (text in dev, json on the VPS), `LOG_LEVEL` as today.
- The allow-list of field names and value shapes; a writer that drops anything else and counts the drops.
- The lint rule (warn): a log call whose first argument is not an event code literal (a template literal, free text, a string with `${`).
- Conversion of `platform/` and `main.ts` as the proof (46 calls), held at lint level error; the modules stay as they are until E8a.

## Out of scope

- The log store, rotation, alerts, the canary test (E8a, E8b). The conversion of the modules, `web.ts`, `composition.ts`, `retention.ts` and the scripts (E8a).
- A context per Telegram update (E8a).

## Acceptance

- With `LOG_FORMAT=json`, `bun run start` writes one JSON object per line with `time`, `level`, `module`, `event`, `msg` and only allow-listed fields (a test spawns the server).
- A unit test proves that an unknown field and a long string value are dropped and counted.
- A job tick and an HTTP request carry `run_id` or `request_id` in every line of their context (integration test over one triage run and one `/api/me` request at the same time).
- Every response has the `x-request-id` header.
- `bun run lint` warns on `log.info(\`…${x}…\`)`and passes on`log.info("event_code", { … })`; a fixture proves both.
- `LOG_FORMAT=text` prints the readable form `[module] event key=value …`.
- `docs/code-patterns.md` and the styleguide state the log standard; ADR 0024 records points 1 (base) and 2 as landed.

## Slices

Seven worker jobs, one per stage in `stages/`: 01 the writer `[risky]`; 02 the format setting and the log context; 03 run and request ids; 04 the lint rule; 05 convert `platform/`; 06 convert `main.ts` and hold the converted files at error; 07 the standards. In order, except 04, which may run next to 02 or 03. No migration, no `bun.lock` change. Stages 01, 03 and 05 get a review job. No owner checkpoint. Commands: [plan.md](plan.md) § "How to run".

## Sequenced

- Plan after: none (the plans of F086 and F087 exist; this plan uses F086's `eslint.config.js` layout and no interface of F087).
- Build after: F086, the module borders lint (`docs/product/stage-2/07-foundation-plan.md` §1: "Needs F086"), in `spec/features/done/`.
- Gate: an F089 stage never builds at the same time as a stage of another ticket that edits the same file (`07-foundation-plan.md` §2; list in `plan.md` D27): stage 01 (`test/preload.ts`) not next to F087 stage 2; stage 02 (`platform/config.ts`, `main.ts`, `.env.example`) not next to F087 stages 1, 2, 4 or F090 stage 1; stages 03 and 05 (`platform/http.ts`, `scripts/job-run.ts`, `platform/llm/client.ts`) not next to F087 stages 4, 5 or F090 stage 1; stage 06 (`main.ts`) not next to F087 stage 2 or F090 stage 1; stage 07 (docs) not next to the docs stages of F087 (3, 6), F088 or F090. After stage 06, later stages that log in `platform/` or `main.ts` use the event form (`plan.md` D28).

## Notes

Design and stages: [plan.md](plan.md); open defaults: [questions.md](questions.md). Source: ADR 0024, PD-051, review §3.11.
