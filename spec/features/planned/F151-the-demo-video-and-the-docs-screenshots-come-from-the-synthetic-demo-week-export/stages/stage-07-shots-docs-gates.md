# F151 stage 07 — Shots from the export, docs and owner gates

Needs stage 06: the `uploadVerdict` lines and the README result line. Needs coordinator step C1: the export file.

Part of [`../plan.md`](../plan.md). Decisions P4, P6, D10.

## Goal

The docs shots are made once from the export and pass every check. The owner gate texts say exactly when the seed may be committed and when a video may be uploaded.

## Step 1 — shots from the export

Run the shots with the export (Proof). The shot code needs no change (P6). A failure is a finding:
- `public_content <rule> <match> in shot <name>` on demo-week text: stop and ask (stage 06 rule); no allow-list entry.
- a shot that differs because mailbox A is paused: the demo alt texts (`DEMO_SHOTS`) already say "demo organization"; fix only an alt text that is now false.

Record in the note (step 3) the size of the export in bytes and the result line of the run. Never copy the export into the repo.

## Step 2 — docs

- `docs/capabilities/live-lab.md` rule 24.9: shots take the demo source locally through `DEMO_SEED_FILE`; CI and the deploy take it only when the seed is committed at the default path (G2).
- `docs/release-checklist.md` step "When the demo flow changed": the command with `--seed`, the flock, the upload line, and "upload only a run whose last line is `demo_source demo: upload candidate`".
- `deploy/README.md` § Docs site: G3 needs an upload candidate; a provisional classifier gate file makes every take `not for upload: gate_provisional` until the owner audit of that file.
- ADR 0030 § Built (E10b): one line that the demo video records live on the demo seed with a loopback replay of the demo week's answers.

## Step 3 — the note for the owner gates

Append a section "F151" to `notes/2026-11-20-f121-close-out.md`:
- What the video shows now: all eight steps live, the model answers replayed from the demo week (Q2), the global proof from the real gate file (Q1).
- G2: the export size and "under 5 MB: yes|no"; the command; "a commit to the public repo cannot be taken back".
- G3: the verdict of the stage 06 run; what makes it an upload candidate (a final gate file, then a new take); the upload and pin steps stay as in F121's text.
- C2: drop `f121_demo` at close; a new take later needs a new `*_demo` database.

## Decisions

- No stage writes the seed, a video file, a hash pin or `OWNER_REVIEW_PENDING`.
- Words follow the house rule: no person, real address or host in a doc or note.

## Test

No new unit test: this stage changes docs and runs the shots. The shots run is the test:
1. The log holds `shots_source demo`.
2. `shotFilesProblem` passes: exactly 20 PNGs in `apps/docs/public/shots/` (git-ignored).
3. `bun run docs:build` with `DOCS_SHOTS=on` and the same `DEMO_SEED_FILE` (the alt texts follow the source) passes the image check (`image_outside` and `shot_missing` absent).

## Proof

```
mkdir -p /tmp/f151-s07 && DEMO_SEED_FILE="$HOME/.local/share/email-assistant/demo/demo-seed-day5.json" bun run docs:shots > /tmp/f151-s07/shots.log 2>&1 && DEMO_SEED_FILE="$HOME/.local/share/email-assistant/demo/demo-seed-day5.json" DOCS_SHOTS=on bun run docs:build > /tmp/f151-s07/docs.log 2>&1 && echo SHOTS_OK
```

Use `flock /tmp/email-assistant-shared-tests.lock` before each command while `CLAUDE.md` still names the lock for `docs:shots`. Then the last line of `bun run check:job`.

## Done when

- Tests 1–3 show in the saved logs.
- The four docs and the note say the same rule for an upload candidate.

## Out of scope

- G2 and G3 themselves. Emptying `OWNER_REVIEW_PENDING` (F121 G1).
