# Operations facts (E8 discovery, 2026-11-13)

Facts a later agent needs for logs, alerts, releases and the VPS. Decisions: `docs/product/stage-2/epics/E08-operations.md` § Discovery; detail: `E08-discovery-notes.md`; ADR draft 0024.

## Code (commit `51ce4b1`)

- `apps/server/src/platform/log.ts` writes text `[module] …` with `console.log` / `console.error`. 426 log calls outside tests in 73 files (`grep -rn "log\.\(info\|warn\|error\|debug\)(" apps/server/src packages --include=*.ts | grep -v "\.test\.ts"`). Most put ids into a template literal.
- 24 log calls print `error.message` (mostly CLI scripts). Use `describeError()` from `platform/errors.ts` (name + code) instead.
- No `run_id`, `request_id` or `AsyncLocalStorage` in `apps/server/src`. `AsyncLocalStorage` from `node:async_hooks` keeps its store across `await` and `setTimeout` in Bun 1.4.4 (checked locally); the image uses `oven/bun:1.3.14`. `statfs` from `node:fs/promises` works in Bun.
- Scheduler jobs (`apps/server/src/main.ts`): `mail.sync` every 5 min (5-field cron `*/5 * * * *`); `triage.worker`, `actions.committer`, `channels.notifier` every 15 s; `platform.heartbeat` every 5 min. So an urgent mail waits up to 5 min for the sync: M5 (< 5 min) cannot hold at p95 by polling at 5 min. Interia supports IDLE (`notes/2026-11-03-interia-imap-capabilities.md`).
- SLO data in Postgres: `mailboxes.last_synced_at`; `outbox` rows with `kind` in `digest`, `urgent`, `auth_error`, `sync_stale`, `sync_ok` and `sent_at`, `status`, `error_code`.
- `deploy/compose.yaml` has no `logging:` key. Version `0.0.1` in `package.json`; no git tags; no `CHANGELOG.md`. The repo `Artexs/email_assistant` is public (`gh repo view`): GitHub secret scanning and Dependabot are free.

## External (checked 2026-11-13)

- Docker `json-file` driver: default no size limit, one file. `local` driver: 5 × 20 MB, compressed. Since Engine 20.10, `docker logs` works with every driver ("dual logging"). Sources: docs.docker.com logging driver pages; moby `daemon/logger/local/local.go` v28.5.2.
- VictoriaLogs: single binary, built-in UI at `/select/vmui/`, retention by time and disk size; `-memory.allowedPercent` caps caches only, not RSS (GitHub VictoriaMetrics/VictoriaLogs issue 1031): set a container memory limit.
- vlagent: file collector `-fileCollector.glob` with rotation and checkpoints; JSON lines parsed (`msg`/`message`/`log` → `_msg`; `time`/`timestamp`/`ts` → `_time`); no Docker source. Vendor benchmark (2026-03-20): 28 MiB mean memory at 10k logs/s; Vector 154 MiB; Vector and Fluent Bit sent some broken records on file rotation.
- Healthchecks.io: 20 free checks; Telegram integration through `@HealthchecksBot` (needs the bot in a group to post there).
- GlitchTip (Sentry-compatible): 512 MB minimum, own Postgres (selfhosting.sh, 2026-02).

## VPS (read-only look 2026-11-13, owner's go)

- 16 vCPU; RAM 3.9 GB, 3.0 GB available; `server` 136 MiB, `db` 37 MiB. Swap 3.9 GB.
- Root LV `/dev/mapper/ubuntu--vg-ubuntu--lv` 23 GB, 86 % used, 3.2 GB free. VM disk `sda` 50 GB, `sda3` 46.9 GB: about 23 GB unallocated in the volume group. Grow (owner, sudo): `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv`.
- `docker system df`: images 2.1 GB (673 MB reclaimable), build cache 862 MB reclaimable, DB volume 69 MB.
- Docker 28.5.1, logging driver `json-file`, no `/etc/docker/daemon.json`. Container names `email-assistant-server-1`, `email-assistant-db-1`. `docker compose ps` over SSH without the `.env` fails on the `:?` variables: use container names or `cd ~/email_assistant` with the env loaded.
- Log volume: about 0.5 MB a day (`server` 239 lines, 40 KB in about 2 h; `db` 65 lines).
- Image `ea-server` 673 MB; a cold build needs 2–3 GB of build cache.
