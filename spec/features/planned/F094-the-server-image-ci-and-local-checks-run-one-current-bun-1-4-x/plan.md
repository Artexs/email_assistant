# F094 · One current Bun (1.4.4): plan

> **Status 2026-11-13 — planned.** Two stages written; cold review done (FAIL, 3 major) and handled. Nothing is built.

Ticket: [ticket.md](ticket.md). Defaults to confirm: [questions.md](questions.md).

## Planning progress

- [written] Collect, facts, probes (2026-11-13; probes in `.probe-f094/` of the planner worktree, not committed).
- [written] Stage 1 — `stages/stage-01-pin-1-4-4.md`
- [written] Stage 2 — `stages/stage-02-vps-deploy.md`
- [written] Cold review (`plan-review-1.md`; findings handled in § Cold review)

## Input

The ticket (opened by the coordinator after F093 stage 1, 2026-11-13) is the input. Its outcome, word for word:

> The server image, CI and every local check run the same current Bun (1.4.x). The pin in `.bun-version` is the only place that holds the version. The test-certificate workaround for Bun 1.3.14 is gone, and STARTTLS to a mail host given as an IP address verifies the certificate.

Its limits, word for word: "Any change to the mail host guard (`host-guard.ts`) or its IP-literal rule." and "Other dependency upgrades." are out of scope. "A deploy of the image on the home VPS keeps the pilot mailbox syncing (owner's go needed)."

The decision that created the ticket (F093 `questions.md` Q1, default (a), accepted with the F093 plan): "keep 1.3.14 in F093, pin it in `.bun-version`, and open a follow-up ticket … with a deploy step". F093 D9: "remove `DNS:localhost` when `.bun-version` moves past 1.3". F093 NV3: "Whether F7 also hits IMAP STARTTLS (imapflow) to an IP host."

Planner role (owner, 2026-11-13, `notes/2026-11-13-limen-planner-role.md`): small questions get a default in `questions.md`; a plan without `needs-adam` builds without a new owner OK. This job's task: "A VPS step needs the owner's go: mark it as an owner step, never run it."

## Differences found at collect (2026-11-13)

1. **The F093 note calls the 1.3.14 STARTTLS quirk "fail closed". It is also fail-open** for one case: on 1.3.14 a STARTTLS upgrade to an IP host accepts a certificate issued for `localhost` from a trusted CA (F4). Public CAs do not issue `localhost` certificates, so the practical risk was low, but the note and the alert entry must say it. 1.4.4 refuses it.
2. **NV3 is answered, and IMAP STARTTLS is not a product path.** The IMAP adapter never runs STARTTLS (F5). imapflow over TLS to any IP-literal host fails on both Bun versions for another, known reason (`servername: false`, `notes/2026-11-03-imapflow-tls-under-bun.md`). The upgrade does not change it.
3. **`deploy/README.md` line 62 names an old sync log line** (`sync <mailbox id> <mode>: fetched …`). The code writes `synced <mailboxId>: folders N, fetched …` (F12). The deploy check of stage 2 uses the code's form, so stage 1 fixes the line.
4. **CI does not run on Limen job branches** (`limen/…`); it runs on `master` and `task/**` (F11). Without a step, the first CI run on Bun 1.4.4 would be on `master`.

## Facts checked (2026-11-13)

Probes ran in `.probe-f094/` of the planner worktree with the PC's Bun 1.4.4, `bunx bun@1.3.14`, Node 26.13.1, imapflow 1.7.8 and nodemailer 10.3.1 from the main checkout's `node_modules`.

- **F1 Versions.** `gh api repos/oven-sh/bun/releases`: 1.4.0 (2026-08-20), 1.4.1, 1.4.2, 1.4.3, 1.4.4 (2026-10-22, the latest, not a prerelease). Docker Hub `oven/bun` has the tag `1.4.4` (2026-10-22). `bun --version` on this PC: 1.4.4. `bun.lock` already holds `@types/bun@1.4.4` and `bun-types@1.4.4`.
- **F2 Today's pin.** `.bun-version` = `1.3.14`; `deploy/Dockerfile` line 1 = `FROM oven/bun:1.3.14`. `ci.yml` reads `bun-version-file: .bun-version` in jobs `ci` and `e2e`; job `image` runs `test "FROM oven/bun:$(tr -d '[:space:]' < .bun-version)" = "$(head -n 1 deploy/Dockerfile)"`. `scripts/ci-bun.sh` runs `bunx bun@<.bun-version>`. No `engines` or `packageManager` field names Bun.
- **F3 STARTTLS to an IP host, certificate SAN `IP:127.0.0.1` only.** 1.3.14: `tls.connect({ socket, host: "127.0.0.1", ca })` fails `ERR_TLS_CERT_ALTNAME_INVALID … Host: localhost.`; nodemailer STARTTLS (the `buildSmtpTransportOptions` shape: `secure: false, requireTLS: true, tls: { ca }`, no `servername`) fails the same way; implicit TLS passes. 1.4.4: all three pass (`authorized=true`, login inside TLS). The real `smtp-starttls.test.ts` with SAN `IP:127.0.0.1`: 1.4.4 → 9 pass; 1.3.14 → 7 pass, 2 fail (`verifySmtpLogin upgrades first …`, `openSmtpSender sends after the upgrade`).
- **F4 Wrong-name certificate (SAN `DNS:localhost`, CN `localhost`, given as `ca`), STARTTLS to 127.0.0.1.** 1.3.14: raw upgrade `authorized=true`, nodemailer login succeeds inside TLS (fail-open); implicit TLS refused. 1.4.4: all refused with `ERR_TLS_CERT_ALTNAME_INVALID … IP: 127.0.0.1 is not in the cert's list`. The probe test of D4 (copy of the real file): 1.4.4 → 10 pass; 1.3.14 → the new test fails (no error), as do the 2 tests of F3. Exact error on 1.4.4: `HardError` with message `SMTP verify failed (ERR_TLS_CERT_ALTNAME_INVALID)`.
- **F5 NV3 (IMAP).** `imapFlowOptions` (`apps/server/src/modules/mail/imap/client.ts:77-95`) sets `secure` true for every non-loopback host; plain IMAP is allowed only to loopback and then sets `doSTARTTLS: false`. So the product never runs IMAP STARTTLS. imapflow 1.7.8 sets `servername = false` for an IP host (`imap-flow.js:455`) and passes it to `tls.connect` for implicit TLS and for STARTTLS (`imap-flow.js:1785`). Under Bun 1.3.14 and 1.4.4 both throw `servername argument must be an string` before any certificate check; under Node 26.13.1 implicit TLS to the IP passes. An explicit `servername: "127.0.0.1"` is refused on all three (`ERR_INVALID_ARG_VALUE`). Same as `notes/2026-11-03-imapflow-tls-under-bun.md`; it fails closed.
- **F6 The product path for a DNS host** (connect to the resolved IP, `servername` = the name, as `resolveMailHost` returns): imapflow implicit TLS and nodemailer implicit TLS pass on 1.3.14 and 1.4.4 with a matching name; a wrong `servername` is refused on both.
- **F7 Lockfile.** `bun install --frozen-lockfile` on 1.4.4 in a clean copy of the files the Dockerfile copies (`package.json`, `bun.lock`, four workspace `package.json`): exit 0, 967 packages, `bun.lock` byte-identical (`cmp`). `bun.lock` has `lockfileVersion: 1`, `configVersion: 0`. Bun 1.4 keeps v1 lockfiles and the hoisted linker of existing projects (release blog, "Upgrading to 1.4").
- **F8 Image.** `deploy/Dockerfile` with line 1 `FROM oven/bun:1.4.4`, built locally through `newgrp docker` (`notes/2026-11-08-docker-socket-newgrp.md`): build exit 0 in 32 s; `bun --version` in the image = `1.4.4`; `/app/apps/web/dist/login/index.html` exists; `/app/tools` holds only `fake-telegram/package.json`; `platform/config.ts` imports. The agent shell has no `docker` group: plain `docker` answers `permission denied`.
- **F9 Unit suite on 1.4.4** at `201906a` (a `git archive` copy): `bun run test:unit` 1877 pass, 0 fail, 25.6 s. `test:int` was not run (planner rule). Before F093 stage 3 every worker proof ran `test:int` on the PC's 1.4.4 (F093 F4).
- **F10 Bun 1.4 upgrade notes** (`bun.com/blog/bun-v1.4`, "Upgrading to 1.4" and "Security", read 2026-11-13), checked against this repo: Node 26 `NODE_MODULE_VERSION` 147 (only native addon in `bun.lock` is `sharp@0.34.3`, N-API, used by `web:build`; F8 built the web app); `res.writeHeader()` removed (no use); paused `readable.read()` returns one chunk (imapflow uses it only to detect injected bytes; F5/F6 probes pass); `Bun.connect`/`Bun.listen` default `rejectUnauthorized: true` (only `Bun.listen` without TLS in `db-role.test.ts`); `Bun.YAML`/`Bun.TOML` strict (no `Bun.YAML`; `bunfig.toml` has one simple table); "Bun invoked as node does not load .env" (not used); `tls.connect` uses `host` as the default `servername` (since 1.3.13, already in the pin).
- **F11 CI triggers** (`ci.yml:3-9`): `push` to `master` and `task/**`, `pull_request` to `master`, `workflow_dispatch`. Limen job branches are `limen/<job>`.
- **F12 Deploy.** `deploy/README.md` § Update: backup, `df -h /` (stop under 3 GB), `git fetch && git merge --ff-only origin/master`, `$C up -d --wait db`, `$C run --build --rm server bun run db:migrate`, `$C up -d --build --wait`. § Roll back (web panel section): write down `git rev-parse HEAD` first; `git checkout <previous commit>`, `$C up -d --build --wait`; never `db:rollback`. `mail.sync` runs `*/5 * * * *` (`main.ts:82`) and logs `synced <mailboxId>: folders N, fetched …` (`mail/jobs.ts:42-44`); errors are `sync <id> failed:` (error), `sync <id>: … the next tick tries again` (warn), `sync <id>: login failed, status is now auth_error` (warn). `mailbox:check --org-id … --mailbox-id …` without `--probe` opens IMAP, reads capabilities and folders, and changes nothing (`mail/check.ts:68-77`).
- **F13 Other text that names 1.3.14:** `smtp-starttls.test.ts:16,29-30`; `apps/server/src/modules/testmail/agentmail/fake.ts:219` (a comment); `docs/known-alerts.md:329,337-338`; `notes/2026-11-13-bun-version-drift.md`; `spec/build.md` TRACK (coordinator prose). Dated history that stays: `docs/product/stage-2/epics/E08-discovery-notes.md:11`, `notes/2026-11-08-*`, `notes/2026-11-10-web-foundation-build.md`, `notes/2026-11-13-operations-facts.md`.
- **F14 Time zones** (cold review, minor 5): `Intl.supportedValuesOf("timeZone")` gives the same 445 names under `bun` 1.4.4 and `bunx bun@1.3.14` on this PC (`Europe/Kyiv` no, `Europe/Kiev` yes). `tenancy/service.ts:34` checks organization time zones against that list (`notes/2026-11-03-bun-timezones.md`). The list inside the image is not checked (NV5).
- **F15 VPS disk** (`notes/2026-11-13-operations-facts.md` § VPS, read-only look 2026-11-13): root volume 23 GB, 3.2 GB free; build cache 862 MB reclaimable; image `ea-server` 673 MB; a cold build needs 2–3 GB of build cache; about 23 GB unallocated in the volume group (grow: `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv`). Server memory 136 MiB. A new `FROM` forces a cold build.
- **F16 DNS-host name test** (D11): the test file of stage 1 step 3 in a `git archive` copy: 4 pass on 1.4.4 and on 1.3.14; `eslint` clean; `bun run typecheck` in `apps/server` exit 0. `imapflow` and `nodemailer` imports are not restricted by `eslint.config.js` (only grammY, Gemini and OpenAI are).

## Not verified

- **NV1** `bun run test:int:ci` on 1.4.4 at the stage 1 commit. Stage 1 Proof runs it.
- **NV2** CI jobs `ci`, `e2e` and `image` on 1.4.4 on GitHub runners. The coordinator's pre-land CI run (D7) checks them; the `setup-bun` step log names the version.
- **NV3** The image on the home VPS: real Interia IMAP over TLS on 1.4.4, Telegram polling, the healthcheck. Stage 2 owner step checks them.
- **NV5** The time zone list inside the 1.4.4 image (F14 is the PC). Stage 2 step 1 compares it before and after the deploy.
- **NV4** A real SMTP send to Interia on 1.4.4. The deploy check does not send mail (`SEND_SCOPE` and the pilot are not touched). F6 covers the code path locally; the first real send after the deploy is the proof. A failure there is fail-closed (no send) and shows as `smtp_error` (`deploy/README.md` § Approvals and sends).

## Design decisions

- **D1 Target `1.4.4` exactly.** The latest stable release (F1) and the PC's Bun, so local, CI and image agree on day one. Rejected: the floating tag `1.4` (the image would change under the same text; the `image` job compares exact text, and the drift comes back silently). Rejected: wait for a later 1.4.x (nothing in F10 asks for it).
- **D2 Two lines change the version.** `.bun-version` → `1.4.4` and `deploy/Dockerfile` line 1 → `FROM oven/bun:1.4.4`, in one commit. `.bun-version` is the source; the Dockerfile line is a copy that the `image` job checks against it (F2). Rejected: a Docker `ARG` that reads the pin (F093 D5: `deploy/compose.yaml` builds with no `args`, so the Dockerfile needs a default anyway, and the version is written twice again). `scripts/ci-bun.sh`, `ci.yml` and `package.json` do not change: they read the pin. No `bun.lock` change: no move to lockfile v2, no `configVersion` change (F7). Rejected: migrate the lockfile now (a dependency change, out of scope; one `bun.lock` change at a time, `CLAUDE.md`).
- **D3 STARTTLS test certificate.** The SAN becomes `subjectAltName=IP:127.0.0.1`; the comment above it says that the certificate names only the IP, so the test proves the name check against the IP host. The relay of F093 D9 stays (it works on 1.3.14 and 1.4.4; changing the server side of a security test brings risk and no gain); the header comment says why it stays: "The relay keeps the server side simple and works on every Bun version." without a version number. Rejected: return to a server-side `TLSSocket` upgrade (not probed on 1.4.4 server side).
- **D4 A regression test for the name check.** One new test in the `STARTTLS against a scripted server …` group: "a trusted certificate for another name is refused on STARTTLS to an IP host and no password goes out". `beforeAll` makes a second pair with `-subj /CN=localhost` and `subjectAltName=DNS:localhost`. `startServer` takes an optional `pair: { key: string; cert: string }` (default: the main pair). The test gives that certificate as `ca`, so trust is present and only the name check can refuse. It expects a `HardError` with the message `SMTP verify failed (ERR_TLS_CERT_ALTNAME_INVALID)` and `fake.seen` equal to `["STARTTLS"]` (F4). Why: it fails on 1.3.14 and passes on 1.4.4, so a later pin that brings the quirk back turns the suite red. This is the proof of the ticket's "STARTTLS to a mail host given as an IP address verifies the certificate". Small question Q3.
- **D5 Comments that name 1.3.14 in code.** `agentmail/fake.ts:219` keeps its code; its comment becomes "Release each held response first: `server.stop(true)` must not wait for a handler that never ends (Bun 1.3.14 waited; see `docs/known-alerts.md`)." The two STARTTLS comments change by D3. No other code change.
- **D6 Docs say the drift is closed.**
  - `notes/2026-11-13-bun-version-drift.md`: a new first section "Closed 2026-MM-DD (F094)": one pin `1.4.4` in `.bun-version` and `deploy/Dockerfile`; the `:ci` scripts stay; the three 1.3.14 behaviours are history; correct "fails closed" (Differences 1, F4); the NV3 result (F5); "VPS: pending (F094 stage 2)". The old `## Rule` section is renamed `## History (pin 1.3.14)`; `## Open` stays, its items marked answered or done; "fails the certificate name check" in `## Effect on product code` becomes past tense with "until F094".
  - `docs/known-alerts.md`: the AgentMail entry (line ~325) and the STARTTLS entry (line ~333) each get one more line `- **Pin:** `.bun-version` is 1.4.4 since <commit> (F094); the 1.3.14 behaviour is gone.` The STARTTLS entry's "Product effect" sentence becomes past tense ("until F094") and gets the F4 fact (it also accepted a `localhost` certificate). Statuses stay `fixed`.
  - `notes/2026-11-03-imapflow-tls-under-bun.md`: append "Checked again 2026-11-13 on Bun 1.4.4: same error; IMAP STARTTLS is not used by the adapter (F094 plan F5)."
  - `deploy/README.md` line 62: the sync line becomes `synced <mailbox id>: folders <n>, fetched …` (Differences 3).
- **D7 CI before the land.** The coordinator pushes the stage 1 job branch to `task/f094-bun-pin` (a normal push of a new branch; never force) and waits for that CI run: `ci`, `e2e` and `image` must pass, and the `setup-bun` log must show 1.4.4. Then it lands and deletes the remote branch. Why: `master` stays green (`CLAUDE.md`); job branches get no CI (F11); the runtime of every job changes at once. Small question Q1. If the owner says no: land, watch the `master` run; a red run is reverted with `git revert` the same day.
- **D8 VPS deploy = owner steps (stage 2).** The owner runs a runbook based on `deploy/README.md` § Update, with these additions (cold review M1–M3, minors 1–3, 5):
  - **Disk:** always `docker builder prune -f` before the build; stop when less than 5 GB is free after it (F15: a cold build needs 2–3 GB; 3.2 GB were free on 2026-11-13), and grow the root volume first (owner, sudo). `df -h /` again after the build. Small question Q5.
  - **Fast rollback:** `docker tag ea-server ea-server:pre-f094` before the build; a rollback re-tags it and runs `up -d --no-build --wait`, so it needs no build and no disk. The tag is removed after the next-day check.
  - **Pin and VPS agree after a rollback:** the coordinator reverts the stage 1 land merge on `master` the same day (`git revert -m 1 <merge>`). Otherwise `master` pins 1.4.4 while the VPS runs 1.3.14, and the next deploy of any ticket brings the failure back.
  - **Checks after the restart:** `bun --version` in the container; at least two `synced <id>: folders` lines for the pilot with the same folder count as before; no sync error line (a wide grep that also covers folder discovery, skipped folders and `mail.sync failed`); no TLS error line; Telegram polling; `mailbox:check` without `--probe`; `/health`; the time zone list unchanged (NV5). The log window starts at the recorded UTC time of the restart, not at "12 minutes ago".
  - **Next-day check:** 24 hours later, about 288 `synced` lines for the pilot, no sync or TLS error line, server memory below 300 MiB. No alerting exists yet (E8b), so this is the only watch.
  - **Other tickets in the deploy:** the coordinator lists the `master` commits since the last VPS update. F069 (Compose subnet pin) has its own VPS step with a `.env` edit; it goes first, in its own window, so a failure is not blamed on the wrong change.
  - **No agent** connects to the VPS.
- **D9 Order.** Build after F086 lands ("F086 next and alone", `07-foundation-plan.md` §2): a pin change moves the Bun of every job's Proof, so it must not land in the middle of another ticket's stages. Small question Q2.
- **D10 Out of scope, said once.** `host-guard.ts`; imapflow's `servername: false` for IP hosts (F5; known since 2026-11-03, fail-closed); the lockfile v2 move; other dependency bumps; `spec/build.md` (coordinator prose).
- **D11 A committed test for the DNS-host path** (cold review, minor 4). New `apps/server/src/modules/mail/imap/tls-servername.test.ts`: `imapFlowOptions` and `buildSmtpTransportOptions` with the target `{ host: "127.0.0.1", servername: <name> }` (what `resolveMailHost` returns for a DNS host) against a TLS server whose certificate (given as `ca`) names `mail.probe.test`. Four cases: IMAP and SMTP each accept the right name and refuse another name. Why: Interia is reached this way; F6 was only a planner probe. It passes on 1.3.14 and 1.4.4 (F16), so it guards later pins, not this one. It does not go through `openImapProvider` or `verifySmtpLogin` because the test preload sets `allowLocal`, and then the guard returns no `servername`.
- **D12 Log text at the deploy commit** (cold review, Q-b). The stage 2 greps depend on the sync log text (`mail/jobs.ts:42-44`). A later ticket (F089 structured logs) may change it before the deploy. The coordinator checks the text at `origin/master` before the handover and adapts the greps.

### Edge cases

- **Two runs at once:** a job that started before the land still has `.bun-version` 1.3.14 in its worktree; its Proof runs on 1.3.14 until it merges `master`. The suite passes on both (F3 tests aside, which change only in this ticket). After its merge, its Proof runs 1.4.4. Nothing to do; D9 keeps F086 out of the window.
- **First download:** `bunx bun@1.4.4` downloads once per machine (cached on this PC since 2026-11-13). On a first download `bunx` may print install lines; the Proof's version check runs after one warm-up call (stage 1 step 1 Check).
- **Restart after downtime / crash in the deploy:** the deploy is `up -d --build --wait`; a failed healthcheck leaves the old container stopped. Rollback is § Roll back. No data changes with the runtime; migrations of other tickets that ride along follow their own runbooks.
- **Two tenants:** the runtime change touches all organizations at once; the stage 2 check reads the pilot mailbox and the error lines of every mailbox (`sync <id> failed`).
- **Secrets:** no agent reads `.env` or prints a key. The owner pastes only the lines that stage 2 lists (versions, `synced` lines, counts); mailbox ids are not secrets. The STARTTLS test password `pw-secret-1` is a test value.

## Done when

1. `cat .bun-version` prints `1.4.4`; `head -n 1 deploy/Dockerfile` prints `FROM oven/bun:1.4.4` (the checked copy, D2); no other file sets a Bun version (`grep -rn "1\.3\.14" .github scripts package.json deploy` prints nothing).
2. `bun run test:unit:ci` and `bun run test:int:ci` pass on 1.4.4 (stage 1 logs).
3. `grep -c "DNS:localhost" apps/server/src/modules/mail/imap/smtp-starttls.test.ts` prints `1` (only the second, wrong-name pair of D4); the main pair's SAN is `IP:127.0.0.1`; the D4 test passes; every assertion of the four old STARTTLS tests is unchanged.
4. `bun.lock` is unchanged against the merge base, and `tls-servername.test.ts` passes: IMAP and SMTP to a DNS host accept the right name and refuse another (D11).
5. The CI run of the stage 1 commit (on `task/f094-bun-pin`, D7) and the next `master` run are green in `ci`, `e2e` and `image`.
6. The VPS server container reports `1.4.4`, and the pilot mailbox has at least two `synced <id>: folders` lines after the restart, with no sync error and no TLS error line (stage 2 step 1); 24 hours later it has 280 or more `synced` lines and the server uses less than 300 MiB (stage 2 step 2).
7. `notes/2026-11-13-bun-version-drift.md` and `docs/known-alerts.md` say the drift is closed and name the commit and the VPS date (stages 1 and 2).

## Rules for every stage

- **Changed files are only:** `.bun-version`, `deploy/Dockerfile` (line 1 only), `apps/server/src/modules/mail/imap/smtp-starttls.test.ts`, the new `apps/server/src/modules/mail/imap/tls-servername.test.ts`, the comment at `apps/server/src/modules/testmail/agentmail/fake.ts:219`, `deploy/README.md` (line 62 only), `docs/known-alerts.md`, `notes/2026-11-13-bun-version-drift.md`, `notes/2026-11-03-imapflow-tls-under-bun.md`, and this ticket folder (stage 2 log only). Any other file is a stop-and-report.
- **No change to `bun.lock`**, no `bun install` that rewrites it, no new dependency, no `bun upgrade` of the PC.
- **Never weaken a security assertion** of the STARTTLS tests: what the server `seen`, `HardError`, `stage: "connect"`, `soft: false`. Never add `rejectUnauthorized`, `checkServerIdentity` or `NODE_TLS_REJECT_UNAUTHORIZED` anywhere.
- No `test.skip`, `test.todo`, CI retry or longer timeout as a fix (`docs/code-patterns.md` § Tests).
- Never read `.env`, never connect to the VPS, never push. Test values only.
- Format only the stage's files: `bunx prettier --write <files>`; never the whole repo.
- A gap or a deviation is a question in the final message, not a choice.
- Before each commit: `git diff --staged` review (`CLAUDE.md`). Commit by explicit paths.
- While working, run only the changed test files on the pin: `bash scripts/ci-bun.sh test <file>`. Two named exceptions: stage 1 step 2 Test 5 runs `smtp-starttls.test.ts` once on `bunx bun@1.3.14` (a cross-check, nothing committed), and stage 1 step 4 runs `bash scripts/ci-bun.sh test apps/server/src/modules/testmail` (the fake whose comment changed). The full chain runs once, as the Proof.

## Proof

Run after the last commit, as one bash call with nothing after it; read the logs in a separate call. List as proven only what a saved log shows. `test:int:ci` needs no lock (each Limen job has its own DB, `CLAUDE.md`).

Stage 1:

```
mkdir -p /tmp/f094-s01 && bun run lint > /tmp/f094-s01/lint.log 2>&1 && bun run typecheck > /tmp/f094-s01/typecheck.log 2>&1 && test "$(bash scripts/ci-bun.sh --version)" = "1.4.4" && test "FROM oven/bun:$(tr -d '[:space:]' < .bun-version)" = "$(head -n 1 deploy/Dockerfile)" && bun run test:unit:ci > /tmp/f094-s01/unit-ci.log 2>&1 && bun run test:int:ci > /tmp/f094-s01/int-ci.log 2>&1 && bash scripts/ci-bun.sh run web:build > /tmp/f094-s01/web-build.log 2>&1 && test "$(grep -c 'DNS:localhost' apps/server/src/modules/mail/imap/smtp-starttls.test.ts)" = "1" && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock && echo PROOF_OK
```

Stage 2 (docs only):

```
mkdir -p /tmp/f094-s02 && bunx prettier --check notes/2026-11-13-bun-version-drift.md docs/known-alerts.md > /tmp/f094-s02/prettier.log 2>&1 && grep -q "VPS: on 1.4.4 since" notes/2026-11-13-bun-version-drift.md && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock .bun-version deploy/Dockerfile apps packages && echo PROOF_OK
```

## User checkpoints

- **Before stage 2** (the VPS deploy): the coordinator stops after the stage 1 land and the green `master` CI run, lists the commits that the deploy brings and any VPS step of another ticket (D8), checks the log text (D12), and asks the owner for the go.

## User steps

- **Stage 2 step 1, owner:** the VPS deploy and its checks (`stages/stage-02-vps-deploy.md`). Only the owner runs it, after the go. It may need the root volume grown first (sudo, D8).
- **Stage 2 step 2, owner:** the next-day check, 24 hours later.
- No `.env` line for F094, no migration, no new account.

## Review

The board's reviewer (`claude-sonnet-5-5`, high) reviews stage 1 before the land: it changes the production runtime and a security test. The reviewer checks D2 (two lines, no `bun.lock`), D3/D4 (every old assertion unchanged; the new test gives the wrong-name certificate as `ca`, so only the name check can refuse; it expects `seen` = `["STARTTLS"]`), D11 (the new file matches the stage text; the wrong-name cases refuse), and that no TLS option was loosened. Stage 2 lands on its proof (docs only).

## Stages

- [ ] Stage 1 [risky] — [Pin 1.4.4, the TLS name checks, the docs](stages/stage-01-pin-1-4-4.md): `.bun-version` and Dockerfile to 1.4.4; SAN `IP:127.0.0.1` and the STARTTLS wrong-name test; the DNS-host name test; comments; drift note, alert entries, imapflow note, README sync line.
- [ ] Stage 2 — [VPS deploy and record](stages/stage-02-vps-deploy.md): owner steps (deploy and checks; the next-day check), then a short job writes the result into the note and the alert entries.

## How to run (coordinator)

1. When F086 is in `done/` (D9): `git mv spec/features/planned/F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x spec/features/active/`, commit (the worktrees see only committed files). Update `spec/build.md` NOW/NEXT.
2. Spawn stage 1:

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "Bun 1.4.4 pin s01 · F094" \
     "Implement F094 stage 01. Read spec/features/active/F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x/ticket.md, plan.md and stages/stage-01-pin-1-4-4.md; build every step of that stage. Final proof: the stage 1 Proof command of plan.md (/tmp/f094-s01), one bash call with nothing after it, run after the last commit; read the logs in a separate call. In the final message, list as proven only what a saved log shows."
   ```

3. When it finishes: read its final message and `/tmp/f094-s01/*.log`. Spawn the review: `limen spawn --review --detached --branch <job branch> --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge --label "review s01 · F094" "Review F094 stage 01 against spec/features/active/F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x/ (ticket.md, plan.md § Review, stages/stage-01-pin-1-4-4.md)."` A finding → `limen continue <job-id> "<fix>"`, then review again (at most 2 rounds, then the owner decides).
4. CI before the land (D7, Q1): from the main checkout, `git push origin <job branch>:refs/heads/task/f094-bun-pin`. Wait for the run: `gh run list --branch task/f094-bun-pin --workflow CI --limit 1 --json databaseId,status,conclusion` (poll; do not block a tool call longer than 2 minutes). Green in `ci`, `e2e`, `image`, and the `setup-bun` step log of job `ci` (`gh run view <id> --log`) names 1.4.4 → go on. Red → read `gh run view <id> --log-failed`; a stage 1 cause → `limen continue <job-id> "<failing test and log lines>"`, push again (normal push), repeat; another cause → `docs/code-patterns.md` § Tests.
5. Land: `limen land <job-id> --yes --keep-open`. Delete the remote branch: `git push origin --delete task/f094-bun-pin`. Drop the job DB: `bun run db:worktree <YYYY-MM-DD>-<hash> --drop`. Change the `spec/build.md` TRACK text "Bun pin `.bun-version` 1.3.14" to "1.4.4". Check the `master` CI run of the land (standing TRACK check).
6. Owner checkpoint: do "Before step 1 (coordinator)" of `stages/stage-02-vps-deploy.md` (commit list, F069 and other VPS steps, the log text, D12). Give the owner steps 1 and 2 of that file. Wait for the go. Never run the steps.
7. When the owner reports a rollback (stage 2 step 1 Rollback): revert the stage 1 land on `master` the same day (`git revert -m 1 <stage 1 merge commit>`, a normal commit; the hook pushes it), check its CI run, and reopen stage 1 with the failing lines (`limen continue <stage-1 job> "<lines>"` or a new job). The ticket stays open.
8. When the owner reports steps 1 and 2 passed: spawn stage 2 step 3 with both reports in the prompt:

   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --timeout 30m --label "Bun 1.4.4 VPS record s02 · F094" \
     "Implement F094 stage 02 step 3. Read spec/features/active/F094-the-server-image-ci-and-local-checks-run-one-current-bun-1-4-x/ticket.md, plan.md and stages/stage-02-vps-deploy.md. The owner's reports: <paste the Report lines of steps 1 and 2>. Final proof: the stage 2 Proof command of plan.md (/tmp/f094-s02)."
   ```

   Land it without `--keep-open`: `limen land <job-id> --yes` closes the ticket.

9. Workers often break the one-`&&` proof form. Accept a check when its saved log shows the pass.

## Cold review

`plan-review-1.md` (Opus 5.5, high, 2026-11-13): FAIL, 3 major, 12 minor, 3 questions. The file is the review job's final message, whole; prettier (pre-commit) changed only blank lines. Stage 1 judged sound; the majors were all in stage 2. What changed:

1. M1 (disk): D8 and stage 2 step 1 runbook 5: always prune, stop under 5 GB free, grow the volume first; `df -h /` after the build; the fast rollback by image tag needs no build (Q5).
2. M2 (no later watch): new stage 2 step 2, the next-day check (288 ticks, errors, memory); stage 2 step 3 records both reports.
3. M3 (pin returns after a rollback): D8 and How to run item 7: the coordinator reverts the stage 1 land merge the same day.
4. Minor 1 (F069 rides along): stage 2 "Before step 1" item 2 names F069 and puts its VPS step first, in its own window.
5. Minor 2 (narrow grep): check 4 also covers `folder discovery failed`, `not on the server, skipped`, `mail.sync failed`; check 3 compares the folder count with the value before the deploy. Not added: `returned below cursor` (a limit warning, not a runtime failure).
6. Minor 3 (time window): checks use `--since "$T"`, the UTC time recorded before the restart.
7. Minor 4 (DNS path untested): D11 and stage 1 step 3, a committed four-case test (probed, F16).
8. Minor 5 (time zones): F14, NV5, stage 2 runbook 2 and check 9.
9. Minor 6: the ticket's Sequenced line now says "must be in `done/` before the build starts".
10. Minor 7: § Rules names the two exceptions.
11. Minor 8: D6 now matches stage 1 step 4 (rename `## Rule` only; `## Open` stays with marks).
12. Minor 9: stage 1 step 1 gives one exact image script, background run and poll.
13. Minor 10: stage 1 step 4 Do 6 says that prettier adds one blank line to the imapflow note.
14. Minor 11: the alert entry and the note get past-tense "Product effect … until F094" texts.
15. Minor 12: `ci.yml:122-123`.
16. Q-a: D2 says that `.bun-version` is the source and the Dockerfile line a checked copy; the ticket Outcome says the same. The `ARG` option stays rejected (F093 D5).
17. Q-b: D12 and stage 2 "Before step 1" item 3.
18. Q-c: stays a default with an owner question (Q1); the final message names it.

## Log

- 2026-11-13: Planned by a planner job (Opus 5.5). Collect, probes on Bun 1.3.14, 1.4.4 and Node 26 (F1–F13); D1–D10; two stage files.
- 2026-11-13: Cold review (Opus 5.5): FAIL, 3 major, 12 minor, 3 questions; all handled (§ Cold review): F14–F16, NV5, D8 rewritten, D11, D12, stage 1 step 3 added, stage 2 steps 2 and 3.
