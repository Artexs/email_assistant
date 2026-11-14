# F103 · E8a Logs: plan

> **Status — planned, nothing built.** Plan base: 560e74e7, refreshed 2026-11-15 (first base `0a5c2ee`). Probes V1–V13, owner words, review record: [plan-facts.md](plan-facts.md). Refresh: [plan-refresh-1.md](plan-refresh-1.md).

## Planning progress

- Word counts (`wc -w`, refresh 1): plan.md 1498; stages 01–19: 684, 635, 303, 410, 630, 694, 650, 573, 578, 692, 679, 686, 697, 691, 432, 636, 697, 699, 700.

## Product decisions

- **P1** Store: VictoriaLogs + vlagent, profile `ops`, tailnet only, 30 days, 1 GB, 256 + 64 MB; fallback Vector; baseline `deploy/logs.sh` (E8 decision 2).
- **P2** Every call converts; the lint blocks the old form; a canary proves it (E8 decision 6).
- **P3** Alerts, releases, drill: F114.
- **P4** No owner checkpoint; an owner step only for the owner's hands.

## Design decisions

"Default" = owner to confirm (questions.md).

- **D1 Field kinds (01):** `uuidFieldNames`, `numberFieldNames`, `codeFieldNames` (F089 D7 rule); `logFieldNames` joins them. A wrong kind is dropped and counted; `LogFields` typed per kind. Rejected: one flat list (each name a string channel). Default (Q1).
- **D2** Code values from closed sets (union, constant, config, route pattern, error name or code); never mail, user or outside-server text. New number names are free; new UUID or code names come from the stage table, else a question.
- **D3 CLI output (02–04):** `createCliOutput(name): CliOutput` (`platform/cli.ts`), `print` stdout, `fail` stderr, `[name] text`, no level or format; only `scripts/` imports it. Old-form script lines move to it, same text. Rejected: scripts as events (CLIs lose content). Default (Q2).
- **D4** Existing `error.message` prints in scripts stay; new ones only in the mail-connection scripts (`mailbox-audit`, `-check`, `-connect`, `-password`, `-probe-move`, `-probe-send`, `-rescan`, `-seed`, `testmail`, `testmail-target`); Telegram errors never.
- **D5 Codes:** `[a-z0-9_]`, ≤ 64, "thing, then what happened"; ids and numbers become fields; a start config line: one code per switch with `scope`, `config_key`.
- **D6** One child per item: `<thing>Log = log.with({ org_id, mailbox_id })`; never a DB read for a log.
- **D7** Errors: `...errorFields`, `...telegramErrorFields` (05); never `error.message`.
- **D8** Each conversion stage puts its paths at lint `error`. 13: one `error` block for `apps/server/src`, `no-console` error, `.message` selector (V9).
- **D9 (13)** Only the event signature; another call shape writes `log_call_invalid`, context only, one drop.
- **D10 (06)** First bot middleware: `withLogContext({ job: "telegram.update", run_id: randomUUID() }, next)`; `bot.catch` logs `update_id`; polling outside.
- **D11 (15–16)** Capture helper `apps/server/test/log-capture.ts`; marker tests use it; the canary fails on a planted string, non-JSON, unknown key, `log_call_invalid`, `dropped_fields`.
- **D12 Drivers (17, changes ADR 0024 point 4):** only `server` `json-file`, others `local`, 10m × 5; the glob sees only `server` (V6). Reason: Postgres row values, CLI answers. Rejected: collector filter (none, V5); Docker-socket collector (env secrets). Default (Q3).
- **D13 (17)** `cli` service extends `server`: profile `cli`, `local` log, `LOG_FORMAT: text`. One-off `run … server` lines in `deploy/`, `docs/` (not `docs/product/`) become `cli`; `check-logging.sh` fails on the old form (V13).
- **D14 (18)** Store per stage file; `-retentionPeriod=30d` (V3); query `"<run_id>" | unpack_json from _msg` (V2). Rejected: parse at ingest.
- **D15 (19)** `tailscale serve` port 9443, no basic auth (ADR 0017). Default (Q4, Q6).
- **D16** A stage converts every old-form call in its files at its base. Tables hold `560e74e7`; match by text.
- **D17** Quotes of converted lines in `docs/known-alerts.md`, `deploy/README.md` change in the same commit.
- **D18 Docs:** 13 code-patterns, styleguide, architecture, ADR Progress, `docs/capabilities/logs.md` (13 or 18 creates it); 14 guard entries; 17 ADR point 4, README; 18 store; 19 ADR `accepted`.
- **D19 Seams:** after 01 new fields go to a kind list; after 04 no old-form script line; after 13 `no-console` errors; after 17 one-off commands use `cli`. Overlaps with active tickets (F097, F105, F106, F119) are advisory; a land conflict → merge `master`, prove again.
- **D20** Rollout: backup, rollback target, verify.
- **D21** No web keys. **D22** ≤ 300 lines a job. **D24** E6 dotted names: reported.
- **D23** CLI text byte for byte; CLI tests unchanged unless the table says so.
- **D25 Guards (14):** JSON format: `installConsoleGuard()` turns `console.*` into text-free `console_output`; `installProcessGuard(log)` logs `process_uncaught_exception` / `process_unhandled_rejection`, exits 1 (V12). Rejected: lint alone (misses library code). Default (Q7).
- **D26 Script events stay (refresh 1, forced by code):** newer scripts (`org-delete`, `org-export`, `org-dsr`, `org-break-glass`, `web-two-factor-reset`, `stats-week`, `mailbox-signals`) print with `process.stdout.write` and log failures as events; CLI tests match that text. Both stay; only old-form lines move to `out`. Rejected: events to `out.fail` (breaks tested text, no privacy gain). Default (Q8).

A decision gap is a question in the final message.

## Done when

1. No `no-restricted-syntax` or `no-console` message in `apps/server/src`; both `error` (13).
2. Wrong kinds dropped; `log.info("x", { count: "a" })` fails typecheck (01, 13).
3. No old-form line in `scripts/`; CLI tests unchanged (04).
4. Telegram update lines carry `job=telegram.update` and `run_id` (06).
5. JSON format hides library console and crash text; exit 1 stays (14).
6. Canary passes; fails on sabotage (16).
7. `check-logging.sh` passes; fails on each fault (17).
8. Profile `ops` adds the store services (18).
9. VPS: one `run_id` search shows the run; no CLI, `exec`, Postgres marker in the store; memory under limits (19).
10. Docs per D18.

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md` § Logs, this file and your stage; build only it. `bunx prettier --write <your files>` only.
- Lines by D5–D7, values by D2. Add a field name to its kind list only if it is missing. Keep each line's level.
- A test that matches an old text changes in the same commit.
- Test addresses `@x.test`; temp files in `/tmp/f103-sNN/`. Fixed `now` `2026-11-20T10:00:00Z`. Restore log level, format and `console` spies; read the drop counter as a difference.
- A type change fixes every caller. No migration, `bun.lock` change or dependency. Commit by explicit path. Never edit `spec/build.md` or another ticket.
- Final message: new field names, calls not in the table, the `no-restricted-syntax` warning count (416 at `560e74e7`).

## Proof

Stages 01–16 (one call after the last commit; read logs separately):

```
mkdir -p /tmp/f103-sNN && bun run lint > /tmp/f103-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f103-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f103-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f103-sNN/int.log 2>&1 && echo PROOF_OK
```

Stages 17–18:

```
mkdir -p /tmp/f103-sNN && bash deploy/check-logging.sh > /tmp/f103-sNN/check-logging.log 2>&1 && bun run lint > /tmp/f103-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f103-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f103-sNN/unit.log 2>&1 && echo PROOF_OK
```

Stage 19: its own checks.

## User checkpoints and steps

No checkpoint (P4). U1 (stage 19, only if `tailscale serve` asks for a password): owner runs `sudo tailscale serve --bg --https=9443 http://127.0.0.1:9428`.

## Stages

`stages/stage-NN-<slug>.md`; (n) = old-form calls at `560e74e7`.

- 01 field-kinds `[risky]`, review
- 02 cli-output (55), review
- 03 cli-mailbox-scripts (71)
- 04 cli-other-scripts (102)
- 05 convert-sender-operator (26), review
- 06 convert-telegram (17), review
- 07 convert-channels-delegation-tenancy (22)
- 08 convert-committer-expiry (18)
- 09 convert-apply-drafts-send (22)
- 10 convert-mail (29), review
- 11 convert-triage (28)
- 12 convert-roots-testmail (26)
- 13 lint-error-everywhere
- 14 console-and-process-guard `[risky]`, review
- 15 log-capture-helper
- 16 canary `[risky]`, review
- 17 log-drivers-and-cli-service, review
- 18 log-store, review
- 19 vps-rollout (coordinator, VPS)

Order: 01 first; 02 → 03 → 04; 05 → 06 and 07; 08 → 09; 10–12 need 01. At most two conversion stages (05–12) at once; a land conflict is a merge. 13 needs 02–12; 14 and 15 need 13; 16 needs 14, 15. 17 needs nothing; 18 needs 17. 19 needs 16, 18, green `master` CI.

## How to run (coordinator)

1. F095 is in `done/`: move the ticket to `active/`, commit.
2. Spawn: `limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --prepare 'bash scripts/limen-prepare.sh' --label "F103-sNN <slug> · F103" "Implement F103 stage NN (spec/features/active/F103-e8a-logs/: ticket.md, plan.md, stages/stage-NN-<slug>.md). Run the plan's Proof after the last commit; claim only what a saved log shows."`
3. Review stages: same model, `--review --detached --branch <B>`: check each test and decision; try to get mail text, an address, a URL, a token or an error message into a log line, or CLI or DB lines into the store. At most 2 rounds.
4. `limen land <id> --yes --keep-open`; drop the job DB. Stage 19 closes the ticket.
5. After 13: warning count 0 → remove the backlog sentence of `spec/build.md` § TRACK; check `master` CI after 13 and 14.
6. Tell other tickets' workers the seam of each landed stage (D19: kind lists, CLI output, lint error paths, `no-console`, `run --rm cli`).
7. After 17: the next dev `up` recreates dev `db` and `greenmail` (tell the owner).

## Cold review

Review 1 (Opus 5.5): FAIL, 7 major, 11 minor, all fixed (plan-facts.md). Refresh 1: no review (no new interface, schema, step or order).

## Log

- 2026-11-14: planned (Opus 5.5); cold review 1 applied; 15 → 19 stages.
- 2026-11-15: refresh 1 at `560e74e7`: 395 → 416 calls, new table rows, D26, Q8, size rule; facts to plan-facts.md.
