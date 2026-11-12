# s2-telegram — Stage 2

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 2 — Core: local time and the digest schedule

- [x] **2.1 Local time, clock texts and quiet hours (`packages/core/src/digest/local-time.ts`)**
  - Goal: pure time-zone helpers for the digest schedule, the quiet hours (P4) and the "HH:MM" texts.
  - Files: create `packages/core/src/digest/local-time.ts`, `packages/core/src/digest/local-time.test.ts`, `packages/core/src/digest/index.ts` (re-exports of the digest folder); change `packages/core/src/index.ts` (add `export * from "./digest";`).
  - Interfaces:
    - `interface LocalDateTime { date: string; time: string; weekday: number }` — `date` `YYYY-MM-DD`, `time` `HH:MM` (24 h), `weekday` 0 = Sunday … 6 = Saturday.
    - `localDateTime(at: Date, timeZone: string): LocalDateTime`
    - `localKey(at: Date, timeZone: string): string` — `` `${date}T${time}` `` (the slot key format of `digests.slot_key`).
    - `localToInstant(date: string, time: string, timeZone: string): Date`
    - `formatClock(at: Date, timeZone: string, now: Date): string`
    - `formatDay(at: Date, timeZone: string): string`
    - `interface QuietHours { start: string; end: string }` and `const QUIET_HOURS: QuietHours = { start: "22:00", end: "07:00" }` (P4; a change is a code change).
    - `isQuietTime(at: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): boolean`
    - `quietEnd(at: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): Date`
  - Decisions:
    - Read the local parts with `new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at)`, as `triage/quota-day.ts` does. Do not change `quota-day.ts`.
    - Weekday and month names come from fixed English arrays in the file (`["Sun", "Mon", …]`, `["Jan", "Feb", …]`), not from `Intl`, so the texts are the same in every runtime.
    - `localToInstant`: `naive = Date.UTC(y, m − 1, d, hh, mm)`; `offset(t)` = (the local wall clock of instant `t`, read as UTC) − `t`. `first = naive − offset(naive)`; if `offset(first) !== offset(naive)`, the result is `naive − offset(first)`, else `first`. This gives: a normal time → its instant; an ambiguous time (autumn change) → the later instant; a time in the spring gap → the instant one hour later on the wall clock (02:30 → 03:30). The tests fix this behaviour.
    - `formatClock`: same local date as `now` → `"HH:MM"`; same local year → `"D Mon HH:MM"` (`"4 Nov 23:55"`); else `"D Mon YYYY HH:MM"`.
    - `formatDay`: weekday, day, month, for example `"Fri 6 Nov"`.
    - `isQuietTime`: compare `HH:MM` strings. `start === end` → never quiet. `start < end` → quiet when `start ≤ t < end`. `start > end` (over midnight, the default) → quiet when `t ≥ start` or `t < end`.
    - `quietEnd`: not quiet → returns `at`. Quiet and `t ≥ start` with `start > end` → `end` on the next local date. Else → `end` on the same local date. The next local date comes from the date parts with `Date.UTC(y, m − 1, d + 1)` (never by adding 24 hours to an instant). The instant comes from `localToInstant`.
  - Test (`local-time.test.ts`, timezone `Europe/Warsaw`):
    - `localDateTime(2026-11-06T07:00Z)` → `{ date: "2026-11-06", time: "08:00", weekday: 5 }`; `localKey` → `"2026-11-06T08:00"`.
    - `localToInstant("2026-11-06", "08:00")` → `2026-11-06T07:00:00.000Z`; `("2026-07-01", "08:00")` → `2026-07-01T06:00:00.000Z`; spring gap `("2027-03-28", "02:30")` → `2027-03-28T01:30:00.000Z` (local 03:30); autumn `("2026-10-25", "02:30")` → `2026-10-25T01:30:00.000Z` (the later 02:30).
    - `formatClock(2026-11-06T06:55Z, tz, now 2026-11-06T07:00Z)` → `"07:55"`; `(2026-11-04T22:55Z, …)` → `"4 Nov 23:55"`; `(2025-12-31T10:00Z, …)` → `"31 Dec 2025 11:00"`.
    - `formatDay(2026-11-06T07:00Z)` → `"Fri 6 Nov"`.
    - `isQuietTime`: local 21:59 → false; 22:00 → true; 03:00 → true; 06:59 → true; 07:00 → false; with `{ start: "09:00", end: "09:00" }` → always false; with `{ start: "01:00", end: "05:00" }` at 03:00 → true, at 05:00 → false.
    - `quietEnd`: local 22:30 on 6 Nov → `2026-11-07T06:00:00.000Z`; local 06:59 on 7 Nov → `2026-11-07T06:00:00.000Z`; local 12:00 → the same instant back; the spring night: local 23:00 on 27 Mar 2027 (`2027-03-27T22:00Z`) → `2027-03-28T05:00:00.000Z` (07:00 CEST).
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: the digest slot logic (step 2.2), any I/O.

- [x] **2.2 Digest times and the due slot (`packages/core/src/digest/schedule.ts`)**
  - Goal: pure rules for "which digest is due now" (P1, D15), safe across daylight-saving changes and restarts.
  - Files: create `packages/core/src/digest/schedule.ts`, `packages/core/src/digest/schedule.test.ts`; export from `packages/core/src/digest/index.ts`.
  - Interfaces:
    - `const DIGEST_LATE_MS = 6 * 3_600_000` and `const MAX_DIGEST_TIMES = 6`.
    - `parseDigestTimes(raw: readonly string[]): string[]` — DB values (`"08:00:00"`, node-postgres gives seconds) or `"HH:MM"` → sorted, unique `"HH:MM"`; a value that is not a valid time is dropped.
    - `parseDigestTimesInput(input: string): { ok: true; times: string[] } | { ok: false; error: string }` — the CLI input of stage 7.
    - `interface DigestSlot { key: string; date: string; time: string }`
    - `dueDigestSlot(input: { now: Date; timeZone: string; times: readonly string[]; afterKey: string | null }): DigestSlot | null`
    - `nextDigestTime(input: { now: Date; timeZone: string; times: readonly string[] }): { date: string; time: string } | null`
    - `isLateSlot(slot: DigestSlot, now: Date, timeZone: string): boolean`
  - Decisions:
    - `parseDigestTimesInput`: trim; `"none"` (any case) → `{ ok: true, times: [] }`; `""` → error `"empty input"`; else split on `,`, trim each part; each must match `^([01]\d|2[0-3]):[0-5]\d$`, else error `` `bad time: ${part}` ``; sort and drop duplicates; more than `MAX_DIGEST_TIMES` → error `"too many times (max 6)"`.
    - `dueDigestSlot` (D15): `nowKey = localKey(now)`; `lateKey = localKey(now − DIGEST_LATE_MS)`; the candidate dates are the local dates of `now − DIGEST_LATE_MS` and `now` (one or two dates); the candidates are every date × every time, as keys. Keep a key when `key > lateKey`, `key ≤ nowKey` and (`afterKey === null` or `key > afterKey`). Return the greatest kept key (string compare), or null. Earlier missed slots are skipped (only one digest per run). The caller passes `afterKey` = the greater of the last slot key of this user and `localKey(linkedAt)`, so slots before the link never count.
    - Why wall-clock keys: in the autumn hour that repeats, the second 02:30 has the same key as the first, so no second digest; in the spring gap, 02:30 never shows, but 03:00 > 02:30, so the digest goes at 03:00.
    - `nextDigestTime`: the smallest key greater than `nowKey` among today and the next local date × the times; null when `times` is empty.
    - `isLateSlot`: `now − localToInstant(slot.date, slot.time, timeZone) > 10 minutes`.
  - Test (`schedule.test.ts`, `Europe/Warsaw`, times `["08:00", "16:00"]` unless said):
    - `parseDigestTimes(["16:00:00", "08:00:00", "08:00:00"])` → `["08:00", "16:00"]`; `["25:00:00"]` → `[]`.
    - `parseDigestTimesInput`: `"08:00,16:00"` → ok; `" 16:00 , 08:00 "` → `["08:00", "16:00"]`; `"NONE"` → `[]`; `"8:00"`, `"24:00"`, `""` → errors; `"08:00,08:00"` → `["08:00"]`; 7 different times → error.
    - `dueDigestSlot`: now `2026-11-06T06:59Z` (07:59 local), after `"2026-11-05T16:00"` → null; now `07:00Z` → `"2026-11-06T08:00"`; the same with after `"2026-11-06T08:00"` → null; now `12:00Z` (13:00 local) → `"2026-11-06T08:00"` (late, within 6 h); now `14:30Z` (15:30 local) → null (08:00 is more than 6 h back, 16:00 not yet); times `["23:30"]`, now `2026-11-06T23:10Z` (00:10 local on 7 Nov), after `"2026-11-05T23:30"` → `"2026-11-06T23:30"`; after = the link key `"2026-11-06T09:12"`, now `2026-11-06T09:00Z` → null; times `[]` → null.
    - Daylight saving, times `["02:30"]`: `2026-10-25T00:30Z` (first 02:30), after `"2026-10-24T02:30"` → `"2026-10-25T02:30"`; `2026-10-25T01:30Z` (second 02:30), after `"2026-10-25T02:30"` → null; `2027-03-28T01:00Z` (03:00 CEST), after `"2027-03-27T02:30"` → `"2027-03-28T02:30"`.
    - `nextDigestTime`: now `2026-11-06T07:30Z` → `{ date: "2026-11-06", time: "16:00" }`; now `15:30Z` → `{ date: "2026-11-07", time: "08:00" }`; times `[]` → null.
    - `isLateSlot({ key: "2026-11-06T08:00", date: "2026-11-06", time: "08:00" })`: now `07:05Z` → false; `07:11Z` → true.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: reading or storing the times (stages 7, 13).
