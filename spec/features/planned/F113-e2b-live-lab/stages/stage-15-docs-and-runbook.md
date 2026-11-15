# F113 stage 15 — docs and runbook

Part of [`../plan.md`](../plan.md). All decisions; coordinator steps C1–C6.

## Goal

An operator who never saw this plan can start the sim stack on the VPS, run a live day or a week, score it, and reset the demo, from the runbook alone. The docs say what the lab does now.

## Files

- `docs/capabilities/live-lab.md`: complete it (What it does now, Rules, Entry points, Data, Limits, Decisions). Limits name: no clock port; no draft edit (F102 seam); no "not mine" delegate answer; text dates with month and year do not move; `history.json` not seeded (E11a); the month cap counts only the ledger of the machine where the lab runs.
- `deploy/README.md`: a section "Sim stack (`ea-sim`)" with the runbook below.
- `evals/sim/README.md`: a short "Live lab" section that links the runbook.
- `docs/decisions/0021-simulator-stack.md`: status `accepted` (PD-020); add the network namespace choice (D1), the env guard (D3) and the two outbound guards (D4); remove the "[check in the first E2b stage]" note and say where N1 was checked (C1 fills the date).
- `docs/architecture.md`: one line in the deployment part that a second stack `ea-sim` exists and links the page.

## Runbook (the section must hold these steps with their commands)

1. **Disk.** `df -h /`. At least 2 GB free for a live day; the live week waits for owner step O1 (PD-055).
2. **Backup first.** The usual production backup (`deploy/backup.sh`); the sim stack never touches production rows, but the backup names the rollback point.
3. **Build.** At the deployed commit: build `ea-server` as usual, then `docker build -f deploy/Dockerfile.sim -t ea-sim:<sha> --build-arg EA_SERVER_IMAGE=ea-server:<sha> .`.
4. **Env.** `cp deploy/sim.env.example deploy/sim.env`; make `CREDENTIALS_KEY`, `WEB_AUTH_SECRET` and DB passwords; copy the LLM key lines from `.env` with `grep '^OPENAI_API_KEY=' .env >> deploy/sim.env` (never print them). Then `chmod 600 deploy/sim.env`.
5. **Start.** `bun run sim:up` (or the same `docker compose -p ea-sim …` line); migrate with `docker compose -p ea-sim … exec server bun run db:migrate`.
6. **Checks** (record in the ticket log): N1, send from GreenMail to `probe@example.com` and see no outbound connection (`ss -tnp` in the greenmail container, or its log) and the mail stored locally; N2, `restart server` and see Telegram polling and the DB come back.
7. **Panel.** `sudo tailscale serve --bg --https=8443 http://127.0.0.1:8180` (ADR 0017: tailnet only). A sign-in for the owner: the invite CLI; its mail lands in GreenMail; read the link there.
8. **Run.** `exec lab bun run lab seed`, then `lab start --mode day` (or `week` on a Monday). `lab status` each day.
9. **Score.** After the tail: `lab score --run <id>`; copy `LAB_STATE_DIR/results/*` to the repo's `evals/results/`; commit by explicit path.
10. **Demo.** `lab demo-reset --yes`; after day 4, `lab demo-export --day 4 --out …`; copy it to the owner's PC; `bun run lab demo-import --file … --email <owner>` on the dev DB.
11. **Restart order.** `fake-telegram` first, then `server` and `lab` (they share its network namespace). A fake restart loses chats: run `lab seed` again to link the chats.
12. **Stop and roll back.** `bun run sim:down` (volumes stay). Rollback of the whole stack: `down`, then remove the `ea-sim_*` volumes by name. Production is not affected by either.
13. **Rules.** Never set `SEND_SCOPE=all` or a real bot token in `sim.env` (the lab refuses to start). Never point the sim at the production `.env`.

## Tests

The capability map test passes (`capability-map.test.ts`: every path and `bun run` script named exists).

## Done when

The pages above are written; the Proof prints `PROOF_OK`. The final message lists the outside edit for the E8 page (release checklist line "sim stack deploy", ADR 0021 point 7) for the coordinator.

## Out of scope

Running the runbook (coordinator C1–C6). Product code.
