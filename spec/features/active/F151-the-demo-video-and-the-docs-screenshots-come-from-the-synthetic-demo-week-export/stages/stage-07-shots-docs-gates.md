# F151 stage 07 — Shots from the export, docs and owner gates

Needs stage 08: the verdict line and its reasons. Needs stage 06: the README result line. Needs coordinator step C1a: an export of an ended run day 1 or later (a trial export is enough, D12).

Part of [`../plan.md`](../plan.md). Decisions P4, P6, D10, D12, D13. Final-only (C3): the shots run on the day-5 export, the G2 size line and the G3 verdict.

## Goal

The docs shots come once from the newest export and pass every check. The owner gate texts say when the seed may be committed and a video uploaded.

## Step 1 — shots from the export

Run the shots (Proof). The shot code needs no change (P6). A failure is a finding:
- `public_content <rule> <match> in shot <name>` on demo-week text: stop and ask (stage 06 rule); no allow-list entry.
- a shot that differs because mailbox A is paused: the demo alt texts (`DEMO_SHOTS`) already say "demo organization"; fix only an alt text that is false for the day-5 seed (D13). A difference that only a trial seed shows (for example "sorted" on shadow days) goes into the note, not into the text.

Record in the note (step 3) the seed day, the export size in bytes and the run's result line. Never copy the export into the repo.

## Step 2 — docs

- `docs/capabilities/live-lab.md` rule 24.9: shots take the demo source locally through `DEMO_SEED_FILE`; CI and the deploy take it only when the seed is committed at the default path (G2).
- `docs/release-checklist.md` step "When the demo flow changed": the command with `--seed` of the day-5 export, the flock, the upload line, and "upload only a run that exited 0 and whose last `[demo-record]` line is `demo_source demo: upload candidate`" (a failed run ends `not for upload: run_failed`, a trial seed `not for upload: trial_seed`).
- `deploy/README.md` § Docs site: G3 needs an upload candidate; a provisional classifier gate file makes every take `not for upload: gate_provisional` until the owner audit of that file.
- ADR 0030 § Built (E10b): one line: the demo video records live on the demo seed with a loopback replay of the week's answers.

## Step 3 — the note for the owner gates

Append a section "F151" to `notes/2026-11-20-f121-close-out.md`:
- What the video shows now: all eight steps live, the model answers replayed from the demo week (Q2), the global proof from the real gate file (Q1).
- G2: the export size and "under 5 MB: yes|no"; on a trial seed, say "trial, day <n>; the day-5 size comes with the final take"; the command; "a commit to the public repo cannot be taken back".
- G3: the verdict of the stage 06 run; what makes it an upload candidate (an export of day 5 or later, a final gate file, then a new take); the owner checks that `exported_at` of the `demo_seed_day` line is after the end of that day (day 5: 2026-11-27T23:00Z); the upload and pin steps stay as in F121's text.
- C2 and C3: drop `f121_demo` at close; the final take ([`../followup-final-take.md`](../followup-final-take.md)) and later takes need a new `*_demo` database.

## Decisions

- Write no seed, video, hash pin or `OWNER_REVIEW_PENDING`.
- No person, real address or host in a doc or note.

## Test

No new unit test; the shots run is the test:
1. The log holds `shots_source demo`.
2. `shotFilesProblem` passes: exactly 20 PNGs in `apps/docs/public/shots/` (git-ignored).
3. `bun run docs:build` with `DOCS_SHOTS=on` and the same `DEMO_SEED_FILE` (the alt texts follow the source) passes the image check (`image_outside` and `shot_missing` absent).

## Proof

```
SEED=$(ls -1 "$HOME"/.local/share/email-assistant/demo/demo-seed-day*.json | sort -V | tail -1)
mkdir -p /tmp/f151-s07 && DEMO_SEED_FILE="$SEED" bun run docs:shots > /tmp/f151-s07/shots.log 2>&1 && DEMO_SEED_FILE="$SEED" DOCS_SHOTS=on bun run docs:build > /tmp/f151-s07/docs.log 2>&1 && echo SHOTS_OK
```

Prefix each command with `flock /tmp/email-assistant-shared-tests.lock` while `CLAUDE.md` names that lock for `docs:shots`. Then the last line of `bun run check:job`.

## Done when

- Tests 1–3 show in the saved logs (trial or final seed).
- The four docs and the note state one upload-candidate rule.

## Out of scope

- G2 and G3 themselves. Emptying `OWNER_REVIEW_PENDING` (F121 G1).
