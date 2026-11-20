---
touches: [apps/server/src/modules/triage/prompts, evals, docs/capabilities/reply-drafts.md]
opened: 2026-11-20
---
# F164 · The reply drafter writes real sentences so the style gate can pass

## Outcome
A reply draft holds full sentences where the manager's facts are known, not only a greeting and one placeholder line per question. The writing-style suggestion then has room to change the result, so the style gate can pass and the `style_from_sent` flag can go on. The style gate failed at the dev smoke because the current drafter writes skeleton drafts (A and B both 1.85 `style_match`, 18 of 20 ties).

## Scope
- Start at the drafter prompt registry (`apps/server/src/modules/triage/prompts/`); a new prompt version, one file.
- Keep every existing safety check: no invented commitments, placeholders for unknown answers, the draft never sends itself.
- Run the drafter holdout gate again (`bun run eval --sim lab-01 --part holdout`, plus `--judge`) and commit the report and gate file.
- Rerun the style A/B on dev cases and write the result next to `tuning-1.md` of the earlier style ticket.

## Out of scope
- Turning on `style_from_sent` or `reply_drafts` for any organization.
- Changing the style suggestion code or the judge.

## Acceptance
- The new drafter gate file exists and passes the same bars as the current one (no invented commitments, injection cases pass).
- Draft text for a case with known facts holds at least one full sentence beyond the greeting (a test on the eval cases).
- The style A/B dev smoke shows a judge-gain above the futility line, or the report says why not.
- `bun run check:job` passes.

## Notes
Needs a plan first (owner rule: prompt change runs the gate). About $1 to $2 of model runs; use the VPS key in the job environment only, as before.

## Sequenced
Plan after: none (the style ticket F122 is done; the reply-drafts ticket F115 has its stages, and drafter-v4 is in code).
Build after: F122 (in `done/`). Gate: none from the owner; stages 04 and 05 need the OpenAI key in the job environment, which the coordinator gives (as for the F122 gate run).
