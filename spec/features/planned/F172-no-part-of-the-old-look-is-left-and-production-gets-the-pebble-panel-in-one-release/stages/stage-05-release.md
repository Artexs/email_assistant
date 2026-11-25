# F172 stage 05 — Release v0.5.0 to production

Coordinator only (VPS, tag, deploy). Needs stage 04: the release text in `CHANGELOG.md` `[Unreleased]`, `design/` gone. Needs every F166–F171 stage on `master`. Holds the one-VPS-deploy lock until step 5 ends. May run next to 06.

Part of [`../plan.md`](../plan.md). Decisions P1–P4, D7. Commands: `deploy/README.md` § Release, `docs/release-checklist.md`; VPS lessons: `notes/2026-11-15-vps-deploy-queue.md` § Release v0.4.5. A long step runs in the background; the next turn reads it (no `sleep`, no polling).

## Step 1 — Gate and pre-checks (dev machine, `master` tip)

1. P1: `spec/build.md` still holds the rule "The Pebble release takes the contact-sheet go as given once CI is green". If not, ask the owner for "go" on the sheet that `visual-review.md` names, and wait for the answer.
2. P2: `docs/owner-decisions.md` holds the 2026-11-21 record of the 20-draft check.
3. D7: `git diff --name-only v0.4.5 HEAD -- db/migrations` prints nothing. If it prints a file, stop and ask the owner: the ticket says the release holds no migration.
4. No prompt file and no sim stack file changed since `v0.4.5` (checklist steps 3, 4).
5. `bun run db:check-migrations`, `bun run docs:stale --strict` and `bun test apps/docs/src/flagged-text.test.ts` pass.
6. The newest tag is still `v0.4.5` (PB-2). If a fix release came in between, it is the old release in every step below.

## Step 2 — Release commit

`bun run release:prepare 0.5.0`; `git add package.json CHANGELOG.md`; `git diff --staged` shows only the version and the heading `## [0.5.0] - <date>`; `git commit -m "Release v0.5.0"`. The hook pushes `master`; check `.git/auto-push.log` for `PUSH FAILED`.

## Step 3 — CI green, then the tag

At each later wake, read the CI run of the release commit once (`gh run list --commit <sha>`). Red: fix forward; never tag red. Green (ci, image, docs, e2e): `git tag -a v0.5.0 -m v0.5.0 <sha> && git push origin v0.5.0`; check `git ls-remote origin 'refs/tags/v0.5.0^{}'`. "Docs deploy" starts and publishes nothing while `OWNER_REVIEW_PENDING` is not empty: expected.

## Step 4 — Deploy (`ssh home_vm`, `~/email_assistant`)

- **Before:** `ea_env_split_state` prints `split`; `deploy/release-state/state` has `current=v0.4.5` and no `pending`; `git status` is clean (`git checkout -q -- deploy/compose.sim.yaml` if the lab changed it); 3 GB free or more; not within an hour of the 03:30 backup cron. Write `~/ea-logs/v0.5.0/00-pre.log`: the `org_features` md5, the cache name in `curl -s 127.0.0.1:8080/sw.js`, and `org:flag --org-id <id>` per organization (P3: is `docs_links` on?).
- **Run:** `nohup bash -c 'PATH=$HOME/bin:$PATH deploy/release.sh v0.5.0; echo RELEASE_RC=$?' > ~/ea-logs/v0.5.0/release.log 2>&1 &` (the `PATH` gives `backup.sh` the right `rclone`; `docs/known-alerts.md`).
- **Pass:** the log ends `release ok v0.5.0 previous v0.4.5`, `RELEASE_RC=0`, with `backup ok …` and no `Applying:` line.
- **Fail before `pending`:** nothing changed; fix, run again. **After:** step 6.

## Step 5 — Smoke check and watch

1. `bash deploy/check-server-env.sh` → `server env ok keys=<n>`; `/health` 200; `EA_RELEASE=v0.5.0`.
2. From the VPS on `127.0.0.1:8080`: `/login` 200 with `theme-color` `#0a7568`; `/manifest.webmanifest` `theme_color` `#0a7568`; `/sw.js` 200 with a cache name that differs from the pre log; `/offline.html` 200; `/dev/patterns` not 200 (ADR 0037 decision 12).
3. Through Tailscale Serve, `/login` shows the new look in a browser.
4. 30-minute watch with the v0.4.5 watch script: `error` 0, health 200, `restarts=0`, `sync_done` grows, `bun run ops:alerts` has no new open alert. A record, not a stop.
5. The `org_features` md5 is unchanged. Record steps 4–5 as a new section of `notes/2026-11-15-vps-deploy-queue.md`, rollback target `v0.4.5`.

## Step 6 — Rollback (only on trouble)

Triggers: a failure after `pending`; `/health` fails; a new `error` event; a blank panel or a failed sign-in. Run `deploy/rollback.sh`; expect `rollback ok v0.4.5`. No SQL, no restore (D7). Fix forward in `v0.5.1`. Browsers get the old files at the next visit (the cache name changes again).

## Records (not stops)

- Owner: the installed phone app shows the new look after a reload (Chrome may refresh the icon later).
- P3: where `docs_links` is on, the owner sees the "what is new" card with `0.5.0` once; where it is off, write that the card waits for the flag.

## Done when

`release ok v0.5.0 previous v0.4.5` in the VPS log; step 5 is in the deploy note; after stage 06 the ticket gets `outcome.md` and moves to `done/`.
