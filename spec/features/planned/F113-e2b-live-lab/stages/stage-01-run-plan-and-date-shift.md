# F113 stage 01 — run plan and date shift

Part of [`../plan.md`](../plan.md). Decisions D5, D6, D11, D13.

## Goal

Pure core functions that turn the frozen week into a dated live run: which slots go out when, and the mail text with its dates moved by the same offset.

## Files

New folder `packages/core/src/sim/live/` (exported through the core index). A corpus test in `apps/server/src/scripts/` (core may not read files).

## Interfaces (later stages use these names)

```ts
type LiveMode = "day" | "week";
type LiveRunPlan = {
  runId: string; mode: LiveMode; startDate: string;      // YYYY-MM-DD, Europe/Warsaw
  offsetDays: number;                                     // a multiple of 7
  scenarioDays: number[];                                 // 1..7 of the scenario week
  items: { slotId: string; at: string }[];                // UTC ISO, sorted by at, then slotId
  endsAt: string; tailEndsAt: string;                     // UTC ISO
  deadlines: { label: string; due: string }[];            // the profile deadlines, shifted
};
type LiveRunRefusal = { refused: "not_monday" | "dst_change" | "bad_date" };
planLiveRun(input: { scenario: Scenario; slots: Slot[]; mode: LiveMode; startDate: string; runId: string }): LiveRunPlan | LiveRunRefusal;
shiftDatesInText(text: string, offsetDays: number, anchor: string): { text: string; shifted: number };
liveRunId(mode: LiveMode, startDate: string, hex4: string): string;   // "week-20261123-a1b2"
```

`Scenario` and `Slot` are the F097 types in `packages/core/src/sim/`. The caller gives `hex4`; core has no random source.

## Decisions

- Week: `startDate` must be a Monday, else `not_monday`. Scenario day d (1..7) maps to `startDate + d − 1`. `offsetDays` = `startDate − calendar.weekStart`, in days.
- Day: scenario day = the weekday of `startDate` (Monday = 1). `offsetDays` = the date of that run day minus the date of that scenario day. Only that day's slots are in `items`.
- Each slot keeps its Warsaw wall time: convert `receivedAt` to Warsaw local, add `offsetDays` to the date, convert back with `localToInstant` (core). `sent` slots are in `items` too.
- `endsAt` = 00:00 Warsaw after the last run day. `tailEndsAt` = `endsAt` + 4 days (week) or + 1 day (day).
- A Europe/Warsaw offset change between `startDate` 00:00 and `tailEndsAt` gives `dst_change`.
- `shiftDatesInText` changes only these forms, and keeps the source style (zero padding, separator, case of month names):
  - `d.mm.yyyy` and `dd.mm.yyyy`;
  - `d.mm` and `dd.mm` with no year: the year nearest to `anchor` (the scenario `weekStart`); shifted only when that date lies within ±90 days of `anchor` (else it is an amount or a time);
  - `d <month>` with an optional year: Polish genitive (`stycznia` … `grudnia`), English (`29 January`), German (`29. Januar`);
  - `<Month> d` with an optional `, yyyy` (English).
  - A month form without a year takes the nearest year, like `d.mm`.
- A dated form with an invalid day or month (`12.50`, `10.30`) stays. Bare years, month and year (`styczeń 2027`, `January 2027`) and ids (`ZK-2027-0143`) stay.
- Weekday words stay right because the offset is whole weeks.

## Tests (numbered, fixed values)

Unit, `packages/core/src/sim/live/*.test.ts`, with the real `lab-01` calendar (`weekStart` 2027-01-25):

1. Week, start `2026-11-23` → `offsetDays` −63; slot at `2027-01-25T04:37:00.000Z` → `2026-11-23T04:37:00.000Z`.
2. Week, start `2026-11-24` → `{ refused: "not_monday" }`.
3. Day, start `2026-11-27` (Friday) → `scenarioDays` [5], `offsetDays` −63, only slots of 2027-01-29.
4. Day, start `2026-11-28` (Saturday) → `scenarioDays` [6].
5. Week, start `2027-03-22` → `dst_change` (EU change on 2027-03-28). Week, start `2026-10-19` → `dst_change`.
6. Day, start `2027-06-04` (Friday, summer time): a slot at 05:37 Warsaw on 2027-01-29 → `2027-06-04T03:37:00.000Z`.
7. `tailEndsAt`: week from `2026-11-23` → `2026-12-03T23:00:00.000Z` (`endsAt` `2026-11-29T23:00:00.000Z`); day `2026-11-27` → `2026-11-28T23:00:00.000Z`.
8. Shift −63, anchor `2027-01-25`:
   - `do 29.01.2027 o 10:00` → `do 27.11.2026 o 10:00`
   - `29.01` → `27.11`; `1.03.2027` → `28.12.2026`; `5.02.2027` → `4.12.2026`
   - `29 stycznia 2027` → `27 listopada 2026`; `29 stycznia` → `27 listopada`
   - `January 29, 2027` → `November 27, 2026`; `29 January` → `27 November`
   - `29. Januar 2027` → `27. November 2026`
   - unchanged: `ZK-2027-0143`, `budżet na rok 2027`, `12.50 EUR`, `12.05`, `styczeń 2027`.
   - `shifted` counts the changed forms.
9. Same input → same output (no clock read).
10. `liveRunId("week", "2026-11-23", "a1b2")` = `week-20261123-a1b2`.

Corpus test (server): for every week text with offset −364, the dates outside the changed spans do not change. The number of `dd.mm.yyyy` forms within ±90 days of `weekStart` (the test's own regex) equals the number the function shifted.

## Check

`bun test packages/core/src/sim/live` and the corpus test file, then the Proof.

## Done when

All tests pass. `week/` texts are only read, never written. The Proof of `plan.md` prints `PROOF_OK`.

## Out of scope

Message building (stage 02). File reads in core.
