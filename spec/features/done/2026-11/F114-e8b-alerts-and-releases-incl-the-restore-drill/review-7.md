# F114 stage 07 review (Opus 5.5, PASS 4767333f)

Model: Opus 5.5, because the stage is risky: a restore drill runs next to live data on the VPS.

No BLOCKING. The drill cannot reach live data: project `ea-drill`, network `ea-drill_default`, volume `ea-drill_db-data`, no `container_name`, no published port, `env_file` replaced (0 live sentinels in the drill config, 4 in the live one), the server config parses with Telegram, heartbeat, web, OAuth and the three scopes off, mailboxes paused before any server runs, a missing `credentials:check` (stage 08) fails loud (exit 1, server never starts), a missing result line fails, an empty count fails. A clean copy with no `.env` under `env -i` passes deploy/test and deploy-logging (102 pass).

Fixed in a Sonnet continue: N1 (the `build server` step ran before the empty-target guard: `--target new-host` on the live VPS would retag the live `ea-server` image before refusing; run `up -d --wait db` and the guard first) and N8 (the drill containers had `restart: unless-stopped`; use `restart: "no"`).

Carry-over to stage 09 (VPS, Compose 2.40; also in the stage file):
- TG1: y03 is equivalent on Compose 5.6.1. Check on the VPS: `docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env config --format json | jq .networks` shows exactly one subnet 172.29.0.0/24 and the name `ea-drill_default`; `docker network inspect $(docker network ls -q)` shows no other network on 172.29.0.0/24; the config has no live keys for `server` and `cli` and no ports.
- TG2: no disk check before the restore (a second copy of the DB, and the build cache stays after `--down`). Compare `df` with the live DB size first.
- N5: `--profile ops` with the drill set would publish `127.0.0.1:9428`; `restore.sh` never passes a profile and unsets `COMPOSE_PROFILES`; never type a profile by hand with the drill files.
- U1: the real GitHub runner Compose is unverified; the risks: `expect(stderr).toBe("")` fails on any Compose warning, and `HOME=dir` hides a plugin under `~/.docker`. Master CI shows the result.
- shellcheck is not installed.
