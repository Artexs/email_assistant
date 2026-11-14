# F096 · open questions (small, with defaults)

All small: the stage does not change with the answer. The plan uses the default.

- **Q1 — Own VPS deploy, or the next normal one?** Default: the next normal deploy (E8 decision 11; `plan.md` P2). Stage 1 lands with `--keep-open`; the coordinator runs the new runbook check (`deploy/README.md` § Update, D8) at that deploy, then closes the ticket (D12). Why: about 0.5 MB of logs a day; an own deploy restarts the DB for 10 lines of YAML. Default, owner to confirm.
- **Q2 — Host log files of cron jobs (`~/ea-logs/backup.log`, `~/ea-logs/seed.log`)?** Default: out of scope. They are host files, not Docker logs; they grow by a few lines a day (backup) or an hour (seed). A `logrotate` rule needs `sudo` on the VPS. E8b (the alerts and releases ticket, F114) owns the disk alert that catches growth. Default, owner to confirm.
- **Q3 — Dev stack (`greenmail` in `deploy/compose.dev.yaml`) too?** Default: yes, the same block (`plan.md` D3). Why: one rule for every service keeps the check simple. Default, owner to confirm.
- **Q4 — Who recreates the shared dev stack on the PC?** Default: the coordinator runs `bun run dev:up` once after the land, when no job runs `test:int` or `test:e2e` (`plan.md` D11). If it has no Docker access (the planning job had none: `permission denied` on the Docker socket), the owner's next `dev:up` does it. GreenMail loses its in-memory mail at that restart; the dev DB keeps its data. Default, owner to confirm.
