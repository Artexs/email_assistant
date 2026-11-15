---
opened: 2026-11-13
---

# F113 · E2b Live lab

## Outcome

The frozen lab-01 week of made-up mail runs in real time through the real pipeline on a separate sim stack, with delegate bots that answer and a scripted executive that taps. A week scorer then reports per-category results and the Stage 2 metrics M1–M5 and M7 in `evals/results/`. The same stack holds a demo organization with one reset command and an export that a dev database can import. No sim mail or tap can reach a real person (ADR 0021).

## Scope

- Sim stack `ea-sim` (ADR 0021): compose file, sim image, env check.
- `bun run lab`: seed, injector, delegate bots, scripted executive, serve loop, scorer.
- Demo organization: reset, export, import.
- Capability page, runbook, ADR 0021 accepted.
- Coordinator runs on the VPS: a live day, then the live week.

## Out of scope

- New corpus text or a new corpus version (the offline lab, F097, froze lab-01 v1).
- A clock port, or a faster clock.
- Draft edits through the panel API (the E4-A ticket F102 adds the commands; the executive gets a seam).
- The demo video and public pages (E10b, F121).

## Acceptance

- `docker compose -f deploy/compose.sim.yaml config --quiet` passes in CI; every sim service has log rotation and a memory limit.
- `bun run lab score --run <id>` writes `evals/results/sim-<date>-lab-01-day-<id>.md` from the VPS live day.
- The live week report holds M1–M5, M7, the delegate behaviour table and the send-limit hits.
- `bun run lab demo-reset` rebuilds the demo organization; `lab demo-import` loads its export into a dev DB.
- With a wrong env (real bot token, non-loopback Telegram root, `SEND_SCOPE=all`), `lab` refuses to start.

## Slices

15 stages, one worker job each; order and parallel lanes in `plan.md` § How to run. No migration and no `bun.lock` change in any stage. The VPS runs are coordinator steps after stage 15.

## Sequenced

- Plan after: none (F097 landed; it is the only ticket whose interfaces this plan uses).
- Build after: F097 (E2a, in `spec/features/done/`).
- Gate: Owner: grow the VPS root volume (PD-055) before the live week (owner step O1; it does not stop the code stages).

## Notes

§2.1 row 19. The old AgentMail delegate ticket (F066) is already dropped; GreenMail bots replace it. The "delegate answers from another address" case (F040) is planted and reported.
