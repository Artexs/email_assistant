# Draft ticket: the final demo take on the day-5 export

The coordinator opens this as a ticket (`limen ticket new`) when the last F151 stage lands, before C2. It is not an F151 stage (owner rule 2026-11-20: a data run that waits days is a follow-up ticket). Plan: F151 `plan.md` D12, D13, C1, C3.

## Title

The demo video and the docs shots are made once on the day-5 export of the demo week

## Outcome

The recording and the shots that F151 built and proved on a trial export run once on the export of the ended run day 5. The owner then gets the real G2 size line and the G3 verdict, and can decide to commit the seed and upload the video.

## Scope

- Export day 5 after 2026-11-27T23:00Z (F151 C1); check that `exported_at` is after that time.
- A new `*_demo` database (C2 dropped `f121_demo`).
- The stage 06 and stage 07 Proof commands of F151 on that export; the README result line; the G2 and G3 lines of `notes/2026-11-20-f121-close-out.md`.
- The stop-and-ask rules of F151 stage 06 apply: a step that cannot be live, a `publicContentScan` hit on demo-week text, a `demo_wait_timeout` in two takes. Each is a question file in this ticket, not a code change here.
- First real runs on day-5 data: the `auto`-off path of the setup and the re-gate (`autonomy_paused` must stay absent), assist mail on mailbox A.

## Out of scope

- G2 and G3 themselves (owner gates). A code change to the recording: a failure opens a fix ticket.

## Acceptance

- The stage 06 log on the day-5 export: `demo_seed_day 5`, `misses=0`, `demo_llm_checked`, empty `not_live`, and a last line of `demo_source demo: upload candidate` or `not for upload: gate_provisional` (the only reason allowed while the gate file is provisional).
- The stage 07 shots log has `shots_source demo` and 20 shots.
- The close-out note has the day-5 size line and the verdict.

## Preconditions (F151 Q7)

- The production classifier prompt (`prompts.classifier.version`) at the take's checkout equals the seed's prompt version, else `demo_prompt_mismatch`. If master moved it, ask the owner: a new demo week, or a take at the last commit with the old pointer.
- No release changed the sim-stack classifier (provider, model, prompt) from 2026-11-23 to the export, else `demo_seed_mixed_models`.
