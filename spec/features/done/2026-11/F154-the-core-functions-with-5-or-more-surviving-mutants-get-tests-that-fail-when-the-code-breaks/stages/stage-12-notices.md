# F154 stage 12 — notices, weekly report, local time

Needs stage 01: `scripts/test-audit/mutation-gaps.ts` and the run lock in `mutation.sh`. May run next to 02–11, 13–17.

Part of [`../plan.md`](../plan.md). Method: plan.md § Stage method. Decisions P2, P3, D5–D10.

## Functions (audit counts at `4ce3f351`)

| File | Function | Through (exported) | Count |
| --- | --- | --- | --- |
| `digest/notices.ts` | `renderActionFailedNotice`, `renderUrgentNotice` | themselves | 12, 7 |
| `digest/weekly.ts` | `evidenceItems`, `autoItems` (private) | `renderWeeklyReport` | 12, 7 |
| `digest/weekly.ts` | `renderWeeklyReport` | itself | 7 |
| `digest/local-time.ts` | `localInstants` (private) | `localToInstant`, `startOfLocalDay` | 8 |
| `digest/local-time.ts` | `lateMin` | itself | 6 |
| `notices/render.ts` | `renderNotice` | itself | 10 |
| `notices/renderers.ts` | `full` (the Telegram `full` render of the `urgent` kind) | `renderNotice("urgent", …)` | 12 |
| `notices/views.ts` | `trustUrl` (private) | `trustReportUrlSchema`, `trustSettingsUrlSchema` | 6 |

Mutate globs: `src/digest/notices.ts`, `src/digest/weekly.ts`, `src/digest/local-time.ts`, `src/notices/render.ts`, `src/notices/renderers.ts`, `src/notices/views.ts`.

The test audit's cut stages (F125 groups G04, G05, G10) also edit `digest/local-time.test.ts` and `notices/encode.test.ts`. A land conflict is "merge master, re-prove".

## Cases (fixed values)

Assert the whole rendered text or the exact line array; use the view and week builders of the existing test files. Read at `a5399ff1`; review 1 corrected the weekly cases.

1. `renderActionFailedNotice`: the follow-up form with and without `panelUrl`; a `move` with `reverse: false` and a folder (the `toFolder` part) and with `reason: "bad_payload"` (no `toFolder` part); a reverse `move` (source folder appended); a reverse with `reason: "mail_not_found"` (the `notFound` line).
2. `renderUrgentNotice`: `folderTag` `null` and set; `synthetic` true and false; with `attachments` and without; with `suspicious` reasons and without.

Weekly report, all through `renderWeeklyReport` (`AUTO_MIN_LABELS` is 30 at the plan base):
3. Mail line: `m1.important` 0 and `m4.triaged` 0 → the `noMail` line and no `missed` line; `important` 0 and `triaged` 5 → the `missed` line, no `noMail`; `important` 3 and `triaged` 0 → the `missed` line (kills `&&` → `||`). `m1.sample.labelled` 0 → no sample line; 1 → the sample line.
4. Auto items: a category with no `auto` row → no item; one `auto` row with `kept` 29 → `autoFew`; `kept` 30 and `precision: null` → `autoFew`; `kept` 30, `precision` set, `wilsonLower: null` → `autoEnough` with no lower suffix; `wilsonLower` set → the suffix. Two `auto` rows of one category with `kept` 40 and 35 → the 40 row stands; a tie keeps the first row.
5. Evidence items: a row with `trip.tripped: true` and a reason → `autoPaused` with that reason, and no `autoOn` line for the category; `tripped: true` with reason `null` → not paused. An `auto` row with `global: null` → no line. `global.decision` `"go"`, `"none"` and another value → `proof.go`, `proof.none`, `proof.noGo`. `history` absent, and `outcome` `"pass"`, `"fail"`, `"inconclusive"` and another value → `check.none`, `check.pass`, `check.fail`, `check.inconclusive`, `check.noResult`.

Local time (`Europe/Warsaw`):
6. `localToInstant("2026-03-02", "09:00")` → `2026-03-02T08:00:00.000Z`. Spring gap `("2026-03-29", "02:30")` → `2026-03-29T01:30:00.000Z` (wall clock 03:30). Autumn repeat `("2026-10-25", "02:30")` → the later instant `2026-10-25T01:30:00.000Z`; `startOfLocalDay("2026-10-25")` → `2026-10-24T22:00:00.000Z`. 
7. `lateMin` with `from` `2026-03-02T12:00:00Z`: `to` equal → `0`; one minute before → `0`; one minute after → `1`.

The planner probed cases 6 and 7 at `a5399ff1`: all values held.

Notice render:
8. `renderNotice`: a view that fails the kind's schema → `{ ok: false }`; a channel with no renderer for the detail → `{ ok: false }`; a valid urgent view on Telegram `full` → `{ ok: true, message }` with the exact text; a view whose text passes `MESSAGE_MAX_CHARS` (4096) → `{ ok: false }`.
9. Urgent `full` render: one view with every optional field (`suspicious`, `attachments`) and one with none → exact texts.

Trust URL:
10. `trustSettingsUrlSchema`: `https://app.test/settings` → passes; with `?x=1`, `#a`, user info `https://u@app.test/settings`, path `/settings/` and a control character → fail. `trustReportUrlSchema`: `https://app.test/report?mailbox=<uuid>` → passes; no query, and a non-UUID mailbox → fail; an invalid URL → fail.

## Done when

- `results/stage-12.md` meets D5 and D6 for every function in the table.
- Last step: `bun run check:job`.

## Out of scope

- Text tables (stage 13). New notice kinds.
