# F151 stage 03 — Cut timeline and per-source steps

Needs: nothing. May run next to 01 and 02.

Part of [`../plan.md`](../plan.md). Decisions P2, P5, D9.

## Goal

The video keeps only the steps: the time between two steps (the product working off camera) is cut. Each step has its live flag and caption per source. The e2e steps keep their content; the cut applies to both sources (back-to-back e2e steps have no gap of 1 s, so nothing is cut there).

## Interfaces (stage 06 uses these names)

- `type DemoSource = "e2e" | "demo"`.
- `DEMO_STEPS`: each step keeps `id` and `seconds`; `live` and `caption` become `Record<DemoSource, boolean>` and `Record<DemoSource, DemoText>`.
- `stepView(step, source): { id; seconds; live: boolean; caption: DemoText }`.
- `cutPlan(cues: readonly DemoCue[]): { segments: { startMs: number; endMs: number }[]; cues: DemoCue[] }` in `apps/web/e2e/lib/demo/encode.ts`. `cues` are on the cut timeline (the first cue starts at 0).
- `ffmpegArgs({ input, output, segments })` replaces the `trimStartMs` form; one encode of the kept segments, same codec settings as now.
- `toVtt(cues, lang, source)`.

## Decisions

- **What is cut.** Everything before the first cue, and every gap of 1,000 ms or more between the end of one cue and the start of the next. A shorter gap stays in the video and in the cue times (no jump cut for a page change).
- **Order and overlap.** Cues must be in order and must not overlap; else `cutPlan` throws `encode_bad_cues`. An empty cue list throws `encode_no_cues`.
- **Length check.** The 100–130 s check stays on the encoded MP4 (`videoProblem`), now the cut video.
- **e2e captions and flags.** The e2e values are today's values unchanged: not live `shadow`, `report`, `urgent`; their captions start with "Day N:" / "Dzień N:".
- **Demo captions.** All eight steps live; no caption starts with a day. Intent per step (the worker writes en and pl, 1–2 lines each, no person, address, host or organization name):
  1. connect: connect a mailbox; it starts in shadow mode.
  2. shadow: in shadow mode it sorts new mail and only shows what it would do.
  3. report: the history check shows what it would have done with your recent mail.
  4. recommended: one tap turns on the categories that passed.
  5. urgent: an urgent mail arrives; a short notice goes to Telegram.
  6. approval: nothing is sent without you; edit and approve.
  7. delegation: it reminds the person a task was handed to.
  8. undo: every change has Undo.
- **Seconds.** Unchanged (116 s planned). The cut does not change a step's length.

## Test

`apps/web/e2e/lib/demo/encode.test.ts` and `steps.test.ts`:

1. `cutPlan` of cues `[1000–15000, 15200–27000, 90000–108000]` → segments `[1000–27000, 90000–108000]`; cues `[0–14000, 14200–26000, 26000–44000]`.
2. `cutPlan` of `[0–5000, 5999–9000]` (gap 999 ms) → one segment `0–9000`; a gap of 1000 ms → two segments.
3. Overlapping cues `[0–5000, 4000–8000]` → throws `encode_bad_cues`; `[]` → throws `encode_no_cues`.
4. `ffmpegArgs` with two segments: the argument list holds both segment bounds in seconds with 3 decimals (`1.000`, `27.000`, `90.000`, `108.000`), `libx264`, `-an` and one output (an exact `toEqual` of the list).
5. `stepView` for `e2e` gives not-live ids `["shadow", "report", "urgent"]`; for `demo` gives `[]` (`test.each` over the two sources).
6. Caption rules per source: 8 steps, unique ids, planned total 105–125 s, 1–2 lines in en and pl; a not-live caption starts with `Day \d+:` / `Dzień \d+:`; a live caption does not.
7. `toVtt(cutCues, "pl", "demo")` for the cues of test 1 has 3 cues with the `demo` pl captions and the start `00:00:00.000`.

Break check: make `cutPlan` keep the 999 ms rule at `>` instead of `>=`; test 2 must fail.

## Done when

- Tests 1–7 pass.
- `record.ts` and `record.spec.ts` use `cutPlan`, `stepView` and the new `toVtt`; the e2e source logic does not change otherwise.
- Proof: last line of `bun run check:job`.

## Out of scope

- The demo-source steps in the spec and a run of `demo:record` (stage 06).
