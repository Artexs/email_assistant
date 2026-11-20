# F154 stage 12 — notices, weekly report, local time

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–11, 13–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Count |
| --- | --- | --- |
| `digest/notices.ts` | `renderActionFailedNotice`, `renderUrgentNotice` | 12, 7 |
| `digest/weekly.ts` | `evidenceItems`, `autoItems`, `renderWeeklyReport` | 12, 7, 7 |
| `digest/local-time.ts` | `localInstants`, `lateMin` | 8, 6 |
| `notices/render.ts` | `renderNotice` | 10 |
| `notices/renderers.ts` | `full` | 12 |
| `notices/views.ts` | `trustUrl` | 6 |

Mutate globs: `src/digest/notices.ts`, `src/digest/weekly.ts`, `src/digest/local-time.ts`, `src/notices/render.ts`, `src/notices/renderers.ts`, `src/notices/views.ts`.

The test audit's cut stages (F125 groups G04, G05, G10) also edit `digest/local-time.test.ts` and `notices/encode.test.ts`. A land conflict is "merge master, re-prove".

## Cases (fixed values)

Assert the whole rendered text or the exact line array; use the view builders of the existing test files.

1. `renderActionFailedNotice`: one case per failure kind at `HEAD` with a fixed view; a view with an empty subject → the no-subject text, not an empty `""`.
2. `renderUrgentNotice`: with and without a sender name; exact text.
3. `evidenceItems`: an item with both flags false → left out; each flag alone → kept (kills the two `true` mutants on the filter).
4. `autoItems`: the same pattern for the auto filter.
5. `renderWeeklyReport`: `m1.important` 0 and `m4.triaged` 5 → the no-important line; `m1.important` 3 and `m4.triaged` 0 → the code's line at `HEAD`; both 0 → the empty-week text (kills `||` vs `&&`).
6. `localInstants` for `Europe/Warsaw`: a normal day → one instant; the spring DST gap 2026-03-29 02:30 → the code's result at `HEAD`; the autumn overlap 2026-10-25 02:30 → two instants in order (kills `a + b` and the sort mutant).
7. `lateMin`: `toMs` equal to `fromMs`, one minute later, and one minute earlier → the exact minutes (kills `<` vs `<=`).
8. `renderNotice`: one notice kind per branch the mutants hit (the two `if` lines), exact text; an unknown kind → the error at `HEAD`.
9. `full` renderer: one view with every optional field and one with none → exact texts.
10. `trustUrl`: an `https:` URL → kept; `http:`, `javascript:`, a relative path and an invalid URL → the fallback at `HEAD`.

## Done when

- `results/stage-12.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Text tables (stage 13). New notice kinds.
