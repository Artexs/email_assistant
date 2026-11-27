# F172 stage 06 — Release v0.5.0 to production

Coordinator only. Needs stage 05: the release text in `[Unreleased]` and its T10 case. Needs every F166–F171 stage on `master` and the P1 gate. Holds the VPS deploy lock until step 5 ends. May run next to 07.

Decisions P1–P4, D7. Commands: `deploy/README.md` § Release, `docs/release-checklist.md`, `notes/2026-11-15-vps-deploy-queue.md` § Release v0.4.5. Long steps run in the background; a later turn reads the log.

## Step 1 — Gate and pre-checks (dev machine, `master` tip)

1. **P1 gate.** Compare `date` with the expiry of the standing rule in `spec/build.md` (2026-11-25 18:00 Europe/Warsaw, unless the board states a later one).
   - Before the expiry: no owner "go".
   - At or after it, or no rule line: ask the owner for "go" on the sheet that `visual-review.md` names, and whether the 2026-11-21 record of the 20-draft check counts (P2). No step 2 without "go". "Wait for the drafts" holds the release until the F115 `owner-check-20.md` has 20 answers.
2. D7: `git diff --name-only v0.4.5 HEAD -- db/migrations` prints nothing; else stop and ask the owner.
3. No prompt or sim stack file changed since `v0.4.5`; `bun run db:check-migrations` and `bun run docs:stale --strict` pass.
4. The newest tag is `v0.4.5`; else that newer tag is the old release below.

## Step 2 — Release commit

`bun run release:prepare 0.5.0`. Then `bun test apps/docs/src/flagged-text.test.ts` passes before the commit (the text is now under `## [0.5.0]`, which the old T10 case reads; red: fix the text). `git add package.json CHANGELOG.md`; the staged diff is only the version and the heading; `git commit -m "Release v0.5.0"`; no `PUSH FAILED` in `.git/auto-push.log`.

## Step 3 — CI green, then the tag

- **Wake:** per CI run of the commit, `nohup gh run watch <run id> --exit-status > ~/ea-logs/v0.5.0/ci-<run id>.log 2>&1 &`. The next turn (a job wake or an owner message) reads the logs; no turn waits.
- Red: fix forward; never tag red. Green (ci, image, docs, e2e): `git tag -a v0.5.0 -m v0.5.0 <sha> && git push origin v0.5.0`. "Docs deploy" publishes nothing while `OWNER_REVIEW_PENDING` is set: expected.

## Step 4 — Deploy (`ssh home_vm`, `~/email_assistant`)

- **Before:** `ea_env_split_state` prints `split`; the release state has `current=v0.4.5` and no `pending`; `git status` is clean (`git checkout -q -- deploy/compose.sim.yaml` if needed); 3 GB free; not within an hour of the 03:30 backup. `~/ea-logs/v0.5.0/00-pre.log`: the `org_features` md5, the `sw.js` cache name, `org:flag --org-id <id>` per organization (P3).
- **Run:** `nohup bash -c 'PATH=$HOME/bin:$PATH deploy/release.sh v0.5.0; echo RELEASE_RC=$?' > ~/ea-logs/v0.5.0/release.log 2>&1 &` (the `PATH` gives `backup.sh` the right `rclone`).
- **Pass:** `release ok v0.5.0 previous v0.4.5`, `RELEASE_RC=0`, `backup ok …`, no `Applying:` line.
- **Fail:** before `pending`, fix and run again; after it, step 6.

## Step 5 — Smoke check and watch

1. `bash deploy/check-server-env.sh` → `server env ok keys=<n>`; `/health` 200; `EA_RELEASE=v0.5.0`.
2. On `127.0.0.1:8080`: `/login` and the manifest carry `#0a7568`; `/sw.js` 200 with a new cache name; `/offline.html` 200.
3. The web `dist` in the server container holds no `dev/` page (ADR 0037 decision 12). An unsigned `curl` gets `302 /login` in any build: no proof.
4. Through Tailscale Serve, `/login` shows the new look.
5. 30-minute watch with a copy of `~/ea-logs/v0.4.5/watch.sh`: `error` 0, health 200, `restarts=0`, `sync_done` grows, no new open `ops:alerts`. A step 6 trigger inside the window leads to step 6 at once; the rest is a record.
6. The `org_features` md5 is unchanged. Record steps 4–5 as a new section of `notes/2026-11-15-vps-deploy-queue.md`, rollback target `v0.4.5`.

## Step 6 — Rollback (only on trouble)

Triggers: a failure after `pending`, `/health` fails, a new `error` event, a blank panel, a failed sign-in. `deploy/rollback.sh` → `rollback ok v0.4.5`. No SQL, no restore (D7). Fix forward in `v0.5.1`.

## Records (not stops)

- The installed phone app shows the new look after a reload.
- P3: `docs_links` per production organization from the pre log; where off, the card waits for the flag.
- P1: the gate branch taken, with the date of the "go" if one was asked.

## Done when

`release ok v0.5.0 previous v0.4.5` in the VPS log and step 5 in the deploy note. After stage 07: `outcome.md`, move to `done/`.
