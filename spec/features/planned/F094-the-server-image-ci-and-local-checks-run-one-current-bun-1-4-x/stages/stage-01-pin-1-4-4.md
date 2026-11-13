# F094 stage 01 — Pin 1.4.4, the STARTTLS name check, the docs [risky]

Part of [`../plan.md`](../plan.md). Read `plan.md` § Input, § Facts checked, § Design decisions, § Rules for every stage and § Proof first.

Why `[risky]`: it changes the production runtime (the server image) and a security test (no password before TLS). A review job runs before the land, and CI runs on a `task/` branch before the land (D7; the coordinator does that, not you).

Base: `master` with F093 and F086 landed. Today: `.bun-version` = `1.3.14`, `deploy/Dockerfile` line 1 = `FROM oven/bun:1.3.14`, the PC's `bun --version` = `1.4.4`.

## Step 1 — The pin moves to 1.4.4

- **Goal:** CI, the image and the `:ci` scripts run Bun 1.4.4.
- **Files:** `.bun-version`, `deploy/Dockerfile`.
- **Interfaces:** none. `scripts/ci-bun.sh`, `.github/workflows/ci.yml` and `package.json` read the pin; do not change them.
- **Decisions:** D1, D2.
- **Do:**
  1. `.bun-version`: the single line `1.4.4` with a trailing newline (same form as today: `printf '1.4.4\n' > .bun-version`).
  2. `deploy/Dockerfile` line 1: `FROM oven/bun:1.4.4`. No other line changes.
- **Test:**
  1. `bash scripts/ci-bun.sh --version` prints `1.4.4`. Run it once before the Proof (warm-up: a first `bunx` download may print install lines; the Proof compares the whole output).
  2. `test "FROM oven/bun:$(tr -d '[:space:]' < .bun-version)" = "$(head -n 1 deploy/Dockerfile)" && echo SAME` prints `SAME` (the `image` job's check, `ci.yml:121-123`).
  3. `git diff --stat "$(git merge-base HEAD master)" -- .bun-version deploy/Dockerfile` shows 2 files, 1 line changed each.
- **Check (image, optional but asked):** build the image once, as F8 of `plan.md` did. The agent shell has no `docker` group; use `newgrp` (`notes/2026-11-08-docker-socket-newgrp.md`):

  ```
  mkdir -p /tmp/f094-s01 && newgrp docker > /tmp/f094-s01/image.log 2>&1 <<'EOF'
  docker build -f deploy/Dockerfile -t ea-server:f094-s01 . && docker run --rm --entrypoint bun ea-server:f094-s01 --version && docker run --rm --entrypoint test ea-server:f094-s01 -f /app/apps/web/dist/login/index.html && echo IMAGE_OK; docker image rm ea-server:f094-s01
  EOF
  ```

  Run it in the background if it may take longer than 2 minutes (`nohup bash -c '…' &`), then read `/tmp/f094-s01/image.log`: it must hold `1.4.4` and `IMAGE_OK`. If `newgrp docker` itself fails (no access), write that in the final message; the coordinator's CI run on `task/f094-bun-pin` covers the `image` job. Do not try `sudo`.

- **Done when:** Tests 1–3 hold; the image check shows `IMAGE_OK` or the final message says why it could not run.
- **Out of scope:** `bun.lock` (no `bun install` that rewrites it; if `git status` shows `bun.lock` changed after any command, `git checkout -- bun.lock` and report the command); `scripts/ci-bun.sh`; `ci.yml`; `@types/bun` (already 1.4.4, F1); `bun upgrade` of the PC.

## Step 2 — The STARTTLS test checks the name against the IP host

- **Goal:** the test certificate names only `IP:127.0.0.1`, and a new test proves that a trusted certificate for another name is refused on STARTTLS to an IP host, with no password sent.
- **Files:** `apps/server/src/modules/mail/imap/smtp-starttls.test.ts` only.
- **Interfaces:** in the test file only: `startServer(opts: { offerStartTls: boolean; pair?: { key: string; cert: string } }): Promise<Fake>`; when `pair` is missing it uses the module's `key` and `cert`. Module variables `otherKey` and `otherCert` (strings, set in `beforeAll`).
- **Decisions:** D3, D4.
- **Do:**
  1. The header comment (lines 14–17 today) keeps its first two sentences. Replace the third ("At STARTTLS the plain server relays … because Bun 1.3.14 cannot upgrade an accepted socket on the server side.") with: "At STARTTLS the plain server relays the connection to a second, TLS-only server. The relay keeps the server side simple and works on every Bun version."
  2. In `beforeAll`, the first `openssl` call: the SAN argument becomes `"subjectAltName=IP:127.0.0.1"`. Replace the two comment lines above it ("Bun 1.3.14 (.bun-version) checks …" and "… Remove DNS:localhost when .bun-version moves past 1.3.") with one comment: "The certificate names only the IP: the STARTTLS tests prove the name check against an IP host."
  3. In `beforeAll`, after the first pair, make a second pair in the same `dir` with `-subj /CN=localhost` and `-addext subjectAltName=DNS:localhost`, files `other-key.pem` and `other-cert.pem`, and read them into `otherKey` and `otherCert`. Comment: "A second certificate for another name (localhost). Bun 1.3.14 accepted it for a STARTTLS upgrade to 127.0.0.1."
  4. `startServer`: add the optional `pair`. The TLS-only server becomes `createTlsServer(opts.pair ?? { key, cert }, …)`. Nothing else in `startServer` changes.
  5. Add this test inside `describe("STARTTLS against a scripted server with a self-signed certificate", …)`, after "an untrusted certificate is refused and no password goes out" and before "a server without STARTTLS is refused …":

     ```ts
     test("a trusted certificate for another name is refused on STARTTLS to an IP host and no password goes out", async () => {
       const fake = await startServer({ offerStartTls: true, pair: { key: otherKey, cert: otherCert } });
       const error = await verifySmtpLogin({ ...base, port: fake.port, ca: otherCert }).catch((e: unknown) => e);
       expect(error).toBeInstanceOf(HardError);
       expect((error as Error).message).toBe("SMTP verify failed (ERR_TLS_CERT_ALTNAME_INVALID)");
       expect(fake.seen).toEqual(["STARTTLS"]);
     });
     ```

     `base.host` is `"127.0.0.1"` already; the certificate is given as `ca`, so trust is present and only the name check can refuse.

  6. Every other line of the file stays as it is: the four old STARTTLS tests and the five `buildSmtpTransportOptions` tests keep each assertion word for word.
  7. `bunx prettier --write apps/server/src/modules/mail/imap/smtp-starttls.test.ts` and `bunx eslint apps/server/src/modules/mail/imap/smtp-starttls.test.ts`.

- **Test** (numbered cases, fixed values; all run by `bash scripts/ci-bun.sh test apps/server/src/modules/mail/imap/smtp-starttls.test.ts`):
  1. The file reports `10 pass`, `0 fail` on 1.4.4 (F4: the probe copy gave 10 pass).
  2. `verifySmtpLogin upgrades first …`: `seen` = `["STARTTLS", "AUTH tls"]` with SAN `IP:127.0.0.1` only (unchanged assertion; F3).
  3. `openSmtpSender sends after the upgrade`: `seen` = `["STARTTLS", "AUTH tls", "MAIL", "DATA"]` (unchanged).
  4. New: `HardError`, message `SMTP verify failed (ERR_TLS_CERT_ALTNAME_INVALID)`, `seen` = `["STARTTLS"]`.
  5. Cross-check (do not commit anything for it): `bunx bun@1.3.14 test apps/server/src/modules/mail/imap/smtp-starttls.test.ts` gives `7 pass`, `3 fail`: the two tests of cases 2–3 and the new test. Write the counts in the final message. This shows that the suite now catches the 1.3.14 quirk.
  6. `grep -c "DNS:localhost" apps/server/src/modules/mail/imap/smtp-starttls.test.ts` prints `1` (the second pair only); `grep -c "IP:127.0.0.1,DNS" …` prints `0`.
- **Check:** `bash scripts/ci-bun.sh test apps/server/src/modules/mail/imap/smtp-starttls.test.ts`; `bunx bun@1.3.14 test apps/server/src/modules/mail/imap/smtp-starttls.test.ts` (case 5 only).
- **Done when:** cases 1–6 hold.
- **Out of scope:** `smtp.ts`, `client.ts`, `host-guard.ts` and every other product file; no `servername`, `rejectUnauthorized` or `checkServerIdentity` option anywhere; IMAP tests (`imap-tls.test.ts` keeps `localhost`, F5). A test that fails for another reason is a stop-and-report.

## Step 3 — Comments and docs say the drift is closed

- **Goal:** the code comment and the docs no longer describe 1.3.14 as the pin, and they record the facts of this plan.
- **Files:** `apps/server/src/modules/testmail/agentmail/fake.ts` (the comment in `stop()` only), `notes/2026-11-13-bun-version-drift.md`, `docs/known-alerts.md`, `notes/2026-11-03-imapflow-tls-under-bun.md`, `deploy/README.md` (line 62 only).
- **Interfaces:** none.
- **Decisions:** D5, D6.
- **Do:**
  1. `fake.ts` `stop()`: the comment line

     ```ts
     // Bun 1.3.14 `server.stop(true)` waits for in-flight handlers: release each held response first.
     ```

     becomes these two lines (same indent as the old line)

     ```ts
     // Release each held response first: `server.stop(true)` must not wait for a handler that never ends
     // (Bun 1.3.14 waited; see docs/known-alerts.md).
     ```

     The code does not change.

  2. `notes/2026-11-13-bun-version-drift.md`: change the title to `# Bun version drift: closed by the 1.4.4 pin (2026-11-13)`. Directly under it, add a section `## Closed (F094)` with these lines, in plain technical English:
     - `.bun-version` and `deploy/Dockerfile` line 1 hold Bun 1.4.4, the PC's Bun. CI reads the pin; the `image` job checks the Dockerfile. `bun run test:unit:ci` and `bun run test:int:ci` stay the proof scripts (they run the pin).
     - Commit: `<the step 1 commit hash>` (`git log -1 --format=%h -- .bun-version`).
     - The STARTTLS test certificate names only `IP:127.0.0.1`. A new test refuses a trusted certificate for `localhost` on STARTTLS to 127.0.0.1. On 1.3.14 that test fails: 1.3.14 checked the upgrade against `localhost`, so it refused a correct IP certificate (fail-closed) and accepted a `localhost` certificate (fail-open). 1.4.4 checks against the IP.
     - NV3 answered: the IMAP adapter never runs STARTTLS (`imapFlowOptions`: implicit TLS for every non-loopback host; `doSTARTTLS: false` for plain loopback). imapflow over TLS to any IP-literal host throws `servername argument must be an string` on Bun 1.3.14 and 1.4.4 (imapflow passes `servername: false`); see `notes/2026-11-03-imapflow-tls-under-bun.md`. It fails closed; mailbox hosts must be DNS names.
     - VPS: pending (F094 stage 2).

     The last item is plain text, exactly `- VPS: pending (F094 stage 2).`; stage 2 replaces it. Then rename `## Rule` to `## History (pin 1.3.14)` and keep its text. Keep `## Three Bun 1.3.14 behaviours …` and `## Effect on product code`; append to the latter: "Corrected 2026-11-13 (F094): it also accepted a certificate issued for `localhost`." In `## Open`, mark NV3 `answered (see Closed)` and the follow-up ticket line `done: F094`.

  3. `docs/known-alerts.md`:
     - The AgentMail entry (heading starts with ``### `runSend > 3: a lost response is repeated with the same key` ``): after its `**Status:**` line, add this line:

       ```md
       - **Pin:** `.bun-version` is 1.4.4 since <step 1 commit> (F094). The fix stays: `stop()` must not wait for a held handler.
       ```

     - The STARTTLS entry (heading starts with ``### `STARTTLS against a scripted server with a self-signed certificate > `` ): in `**Fix:**`, change "the test certificate SAN is `IP:127.0.0.1,DNS:localhost` (F093 stage 1)" to "the test certificate SAN was `IP:127.0.0.1,DNS:localhost` (F093 stage 1); since F094 it is `IP:127.0.0.1` only, and a test refuses a `localhost` certificate for an IP host". In the "Product effect" sentence add: "On 1.3.14 it also accepted a certificate issued for `localhost`." After its `**Status:**` line add this line:

       ```md
       - **Pin:** `.bun-version` is 1.4.4 since <step 1 commit> (F094); the image runs it after the VPS deploy of F094 stage 2.
       ```

     - No new entry. Statuses stay `fixed (…)`.

  4. `notes/2026-11-03-imapflow-tls-under-bun.md`: append one line at the end of the first list: `- Checked again 2026-11-13 on Bun 1.4.4 (F094 plan F5): the same error. The IMAP adapter never runs STARTTLS.`
  5. `deploy/README.md` line 62: "Each sync log line has the form `sync <mailbox id> <mode>: fetched …`." becomes "Each sync log line has the form `synced <mailbox id>: folders <n>, fetched <n>, …`; a failure is `sync <mailbox id> failed: …`." (`mail/jobs.ts:42-44`, `:85`).
  6. `bunx prettier --write` on the four Markdown files and `fake.ts`.

- **Test:**
  1. `grep -n "1.3.14" apps/server/src/modules/testmail/agentmail/fake.ts` shows only the new comment (with "waited").
  2. `grep -c "Closed (F094)" notes/2026-11-13-bun-version-drift.md` prints `1`; `grep -c "VPS: pending" notes/2026-11-13-bun-version-drift.md` prints `1`.
  3. `grep -c "is 1.4.4 since" docs/known-alerts.md` prints `2`.
  4. `grep -n "synced <mailbox id>" deploy/README.md` finds line 62.
- **Check:** `bunx prettier --check notes/2026-11-13-bun-version-drift.md notes/2026-11-03-imapflow-tls-under-bun.md docs/known-alerts.md deploy/README.md apps/server/src/modules/testmail/agentmail/fake.ts`; `bash scripts/ci-bun.sh test apps/server/src/modules/testmail` (the fake still passes).
- **Done when:** Tests 1–4 hold and the Check passes.
- **Out of scope:** `spec/build.md` (the coordinator changes TRACK at the land); `docs/product/**`; dated notes other than the two named; `CLAUDE.md`, the styleguide and `docs/code-patterns.md` (they name `.bun-version`, not a version).

## Stage done when

- Steps 1–3 are done and committed (explicit paths; one commit per step is fine).
- The final message lists: the step 1 commit hash; the counts of step 2 case 5 (on 1.3.14); the image check result or why it could not run; any command that touched `bun.lock`.
- The stage 1 Proof of `plan.md` § Proof prints `PROOF_OK`, run after the last commit with nothing after it; `/tmp/f094-s01/*.log` hold the passes.
