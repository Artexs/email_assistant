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

- `docker compose -f deploy/compose.sim.yaml --env-file deploy/sim.env.example config --quiet --no-env-resolution` passes in CI; every sim service has log rotation, a memory limit and the env check in its command.
- `bun run lab score --run <id>` writes `evals/results/sim-<date>-lab-01-day-<YYYYMMDD>-<hex>.md` from the VPS live day.
- The live week report holds M1–M5, M7, the delegate behaviour table and the send-limit hits.
- `bun run lab demo-reset` rebuilds the demo organization; `lab demo-import` loads its export into a dev DB.
- With a wrong env (real bot token, unset or non-loopback Telegram root, `SEND_SCOPE=all`), `lab:env-check` exits 1, so no sim container starts its program.

## Slices

16 stages, one worker job each; order and parallel lanes in `plan.md` § How to run. No migration and no `bun.lock` change in any stage. The VPS runs are coordinator steps after stage 16.

## Sequenced

- Plan after: none (F097 landed; it is the only ticket whose interfaces this plan uses).
- Build after: F097 (E2a, in `spec/features/done/`).
- Gate: — (owner step O1, PD-055, is dropped: Owner, 2026-11-15: "22 gigabytes ... enough ... when it has 5, 4 or 2 GB I will perform action." The VPS had 22 GB free on 2026-11-15.) Disk rule: C1 and C4 run `df -h /` first; under 5 GB free, stop and tell the owner.

## Notes

- Owner, 2026-11-15: the week run (C4) may spend its $5 cap ("Yes ... Proceed with it").

§2.1 row 19. The old AgentMail delegate ticket (F066) is already dropped; GreenMail bots replace it. The "delegate answers from another address" case (F040) is planted and reported.
