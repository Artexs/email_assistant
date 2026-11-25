# F171 questions for the owner

Defaults taken by the planner (2026-11-25). The stages build them; a different answer changes one stage, not the plan.

1. [important: user-visible] **Docs theme scope (P1).** Default: only the accent, the mark, the favicon and the font change; Starlight's grays and layout stay. Other option: the Pebble neutral grays too (a new contrast proof for every gray pair). Stage 01.
2. [important: user-visible] **Demo caption (P4).** Default: the e2e caption of step `report` loses the first person: en "Day 3: what it would have done.", pl "Dzień 3: co zrobiłby asystent." (PB-8). Other option: keep "what I would have done" / "co bym zrobił". Stage 05.
3. [minor] **Theme select (P2).** Default: the docs site keeps Starlight's light / dark / auto select; PB-10 is a panel rule. Stage 01.
4. [minor] **Shots light only (P3).** Default: 20 light shots, as today. Other option: dark shots too (40 files). Stage 04.
5. [minor] **Demo-source alt texts (D9).** Default: `DEMO_ALT` changes only where the same words changed in `E2E_ALT`; the F151 final take checks the demo pictures. Stage 04.
6. [minor] **Sweep skips the in-place pages (D6).** Default: stage 03 does not rewrite `CHANGELOG.md` (release history), `deploy/README.md` or `docs/release-checklist.md` (operator pages). Other option: sweep the two operator pages too. Stage 03.
7. [minor] **Prefix keys are not checked one by one (D4).** Default: a docs key such as `switch_move` passes the docs text check through its prefix, also when the panel drops that one switch; the stage 03 sweep is the only guard (accepted risk). Other option: list each prefix key in the check. Stage 03.
8. [minor] **Printed docs pages stay blue (P1).** Default: Starlight's `print.css` keeps its own blue accent; no print rule is added. Stage 01.
