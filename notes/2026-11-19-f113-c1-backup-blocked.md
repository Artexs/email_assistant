# F113 live lab day on the VPS: log of 2026-11-19 (backup blocker resolved)

Job `2026-11-19-f113-live-lab-day-on-the-vps-*`. Runbook: `deploy/README.md` § Sim stack.

## Backup blocker: RESOLVED
The first `deploy/backup.sh` run of this job failed with B2 401. The F114 drill job ran `backup.sh` at the same time. Its run succeeded: `ea-20261119T182245Z.dump.age` (18:22:56Z, 675190 bytes), shown in `deploy/backup-status/status.json`. This is the named rollback point for the sim work. Cause of the 401: probable collision of two runs (guess from the owner, not verified). The nightly cron on 11-18 and 11-19 had failed earlier with a DNS error on `api.backblazeb2.com` (`~/ea-logs/backup.log`). Do not run `backup.sh` while the F114 drill runs (`docker ps` shows `ea-drill-*`, folder `~/ea-drill`).

## Defect found on the first live start: GreenMail API takes port 8080
`greenmail` joins the network namespace of `fake-telegram`. The GreenMail standalone image starts an API server on `0.0.0.0:8080`. `server` also listens on 8080 in the same namespace, so `server` crashed in a loop with `EADDRINUSE` (observed: log of `ea-sim-server-1`; GreenMail log line "Starting GreenMail API server at http://0.0.0.0:8080/"). The CI check `sim:check` did not see it.
Fix (this commit): `deploy/compose.sim.yaml` GREENMAIL_OPTS adds `-Dgreenmail.api.hostname=127.0.0.1 -Dgreenmail.api.port=8099`. The property names come from `GreenMailApiServerBuilder.class` in the image jar. After the fix the GreenMail log says "API server at http://127.0.0.1:8099/" and `server` is healthy and listening.
The VPS checkout (`~/email_assistant`, detached at v0.3.1) holds the same edit as an uncommitted change in `deploy/compose.sim.yaml`; the v0.3.1 original is in `/tmp/compose.sim.yaml.v0.3.1` on the VPS. A release that carries this commit makes the edit unnecessary (`git checkout deploy/compose.sim.yaml` before `deploy/release.sh`).

## Other observations
- `sudo nsenter` needs a password on the VPS. The N1 socket check used `/proc/net/tcp` inside `ea-sim-fake-telegram-1` (`docker exec`). Established peers: 127.0.0.1 and 172.31.0.2:5432 (`db`). No peer on port 25, 465 or 587.
- A long `docker compose ... exec` over one ssh call (migrate) died with exit 137 when `server` restarted (crash loop). Rerun after the fix: `MIGRATE_EXIT=0`.
- N2 restart of `fake-telegram`: `server` did not recover (errors `job_failed`, `outbox_claim_failed`, container still `healthy` because its health check runs inside the old namespace). `up -d --force-recreate --no-deps greenmail server lab` fixed it, as the runbook says. Then `lab seed` again (`link relinked`).
- N2 restart of `server` before seed: chat count 0 -> 1 (the chat was not linked yet, no answer). After seed: 3 -> 5.

## Live day run
Run `day-20261120-215c`, org `lab` (`f67694b4-f9fb-4aac-a153-7563b1b9f08c`), cap $1.00, 155 slots, started 18:38 UTC on 2026-11-19. It is real time: the first slot is 2026-11-20 04:43 UTC and the plan has no clock port. The day ends on 2026-11-20 (about 22:00 UTC), then the tail runs. The serve loop in the `lab` container runs it. Nothing else must restart `fake-telegram`, `greenmail` or the stack until the run stops itself.
Finish (coordinator, after the run shows `stopped`):
```
S="docker compose -p ea-sim -f deploy/compose.sim.yaml --env-file deploy/sim.env"   # in ~/email_assistant on home_vm
$S exec -T lab bun run lab status
$S exec -T lab bun run lab score --run day-20261120-215c --out /var/lib/ea-lab/results
mkdir -p /tmp/ea-lab-results && $S cp lab:/var/lib/ea-lab/results/. /tmp/ea-lab-results/
```
Then `scp` `/tmp/ea-lab-results/sim-*.md` and the `.json` files into `evals/results/` of a normal checkout and commit by explicit path.
