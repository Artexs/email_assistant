# Notes for stages 05 and 06 (from the stage 04 review, filed as review-stage-04-1.md)

- Misses: any classifier call for mail outside the export (trust history sample, old mail in the demo mailbox) is a replay miss and fails the run. Stage 05 setup must keep the demo mailbox to the export mail.
- Flags: the demo organization must keep `open_loops` and `reply_drafts` off. With either on, extractor and drafter calls reach the replay and miss.
- Child jobs: `demo/global-setup.ts` runs its scripts with the plain e2e env (model scope off). A stage that starts a job CLI with the scope on must use the demo env, so `assertLoopbackLlm` covers it.
- Optional polish: print the `demo_replay` and `demo_gate` lines in a `finally` in `record.ts`; use a separate error code for a config problem that is not a loopback problem (`demo_llm_not_loopback: config <KEY>` misleads).
- `demo-plan.json` holds dates as ISO strings; stage 05 must parse them.
