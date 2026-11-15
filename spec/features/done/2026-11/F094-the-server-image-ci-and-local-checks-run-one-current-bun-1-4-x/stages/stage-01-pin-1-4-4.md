# F094 stage 01 — Pin 1.4.4, the TLS name checks, the docs [risky]

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
  2. `test "FROM oven/bun:$(tr -d '[:space:]' < .bun-version)" = "$(head -n 1 deploy/Dockerfile)" && echo SAME` prints `SAME` (the `image` job's check, `ci.yml:122-123`).
  3. `git diff --stat "$(git merge-base HEAD master)" -- .bun-version deploy/Dockerfile` shows 2 files, 1 line changed each.
- **Check (image; required attempt):** build the image once, as F8 of `plan.md` did. The agent shell has no `docker` group; `newgrp docker` gives it (`notes/2026-11-08-docker-socket-newgrp.md`). The build may take longer than 2 minutes, so run it in the background and poll:
  1. Write the script (copy it exactly):

     ```
     mkdir -p /tmp/f094-s01 && cat > /tmp/f094-s01/image.sh <<'OUTER'
     #!/usr/bin/env bash
     cd "$1" || exit 1
     newgrp docker <<'EOF'
     docker build -f deploy/Dockerfile -t ea-server:f094-s01 . && docker run --rm --entrypoint bun ea-server:f094-s01 --version && docker run --rm --entrypoint test ea-server:f094-s01 -f /app/apps/web/dist/login/index.html && echo IMAGE_OK
     docker image rm ea-server:f094-s01
     EOF
     echo IMAGE_SCRIPT_DONE
     OUTER
     ```

  2. Start it from the worktree root: `nohup bash /tmp/f094-s01/image.sh "$PWD" > /tmp/f094-s01/image.log 2>&1 &`
  3. Poll: `sleep 60; tail -n 5 /tmp/f094-s01/image.log` until the log holds `IMAGE_SCRIPT_DONE` (about 1–3 minutes).
  4. The log must hold the line `1.4.4` and the line `IMAGE_OK`. If it holds `permission denied` for the Docker socket, write that in the final message (the coordinator's CI run on `task/f094-bun-pin` covers the `image` job). Do not try `sudo`.

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
- **Out of scope:** `smtp.ts`, `client.ts`, `host-guard.ts` and every other product file; no `servername`, `rejectUnauthorized` or `checkServerIdentity` option anywhere; IMAP tests (`imap-tls.test.ts` keeps `localhost`, F5; the DNS-host path is step 3). A test that fails for another reason is a stop-and-report.

## Step 3 — A test for the name check of a DNS host

- **Goal:** the production path for a DNS mail host (connect to the address that the host guard checked, check the certificate against the host name) has a committed test for IMAP and SMTP, so a later runtime change that weakens it turns the suite red.
- **Files:** new `apps/server/src/modules/mail/imap/tls-servername.test.ts` only.
- **Interfaces:** uses `imapFlowOptions(opts, target)` from `./client` and `buildSmtpTransportOptions(opts, target)` from `./smtp` with `target = { host: "127.0.0.1", servername: <name> }` (the shape `resolveMailHost` returns for a DNS host, `host-guard.ts`). It imports `ImapFlow` from `imapflow` and `createTransport` from `nodemailer` (allowed in `mail/imap/`; no ESLint rule restricts them).
- **Decisions:** D11.
- **Do:** create the file with exactly this content (the planner ran it: 4 pass on 1.4.4 and on 1.3.14; `eslint` and the server `typecheck` pass; F16), then run `bunx prettier --write` on it:

  ```ts
  import { execFileSync } from "node:child_process";
  import { mkdtempSync, readFileSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { createServer as createTlsServer, type Server as TlsServer, type TLSSocket } from "node:tls";

  import { afterAll, beforeAll, describe, expect, test } from "bun:test";
  import { ImapFlow } from "imapflow";
  import { createTransport } from "nodemailer";

  import { imapFlowOptions } from "./client";
  import { buildSmtpTransportOptions } from "./smtp";

  // The product path for a DNS mail host: the client connects to the address that the host guard checked and
  // verifies the certificate against the host name (`servername`). The certificate is self-signed for NAME and is
  // given as a CA, so trust is present and only the name check can refuse.
  const NAME = "mail.probe.test";
  const OTHER = "other.probe.test";
  let dir = "";
  let key = "";
  let cert = "";
  const servers: TlsServer[] = [];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ea-tls-name-"));
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${NAME}`],
        ...["-addext", `subjectAltName=DNS:${NAME}`, "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")],
      ],
      { stdio: "ignore" }
    );
    key = readFileSync(join(dir, "key.pem"), "utf8");
    cert = readFileSync(join(dir, "cert.pem"), "utf8");
  });

  afterAll(() => {
    for (const server of servers) server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A TLS-only line server: writes `greeting`, then answers each line with `reply(line)`. */
  function startTlsServer(greeting: string, reply: (line: string) => string): Promise<number> {
    return new Promise((resolve) => {
      const server = createTlsServer({ key, cert }, (socket: TLSSocket) => {
        let buffer = "";
        socket.on("error", () => undefined);
        socket.on("data", (chunk) => {
          buffer += chunk.toString("latin1");
          for (let nl = buffer.indexOf("\r\n"); nl !== -1; nl = buffer.indexOf("\r\n")) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            socket.write(reply(line));
          }
        });
        socket.write(greeting);
      });
      servers.push(server);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
  }

  function imapReply(line: string): string {
    const [tag = "*", command = ""] = line.split(" ");
    if (command.toUpperCase() === "CAPABILITY") return `* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK done\r\n`;
    if (command.toUpperCase() === "LOGOUT") return `* BYE bye\r\n${tag} OK done\r\n`;
    return `${tag} OK done\r\n`;
  }

  function smtpReply(line: string): string {
    const upper = line.toUpperCase();
    if (upper.startsWith("EHLO")) return "250-fake\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n";
    if (upper.startsWith("AUTH")) return "235 2.7.0 ok\r\n";
    if (upper === "QUIT") return "221 bye\r\n";
    return "250 ok\r\n";
  }

  describe("TLS to a DNS host checks the certificate against the host name", () => {
    test("IMAP accepts the certificate of the host name", async () => {
      const port = await startTlsServer("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n", imapReply);
      const options = imapFlowOptions(
        { host: NAME, port, user: "u", password: "p" },
        { host: "127.0.0.1", servername: NAME }
      );
      const client = new ImapFlow({ ...options, tls: { ca: cert } });
      await client.connect();
      await client.logout();
    });

    test("IMAP refuses a certificate for another name", async () => {
      const port = await startTlsServer("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready\r\n", imapReply);
      const options = imapFlowOptions(
        { host: OTHER, port, user: "u", password: "p" },
        { host: "127.0.0.1", servername: OTHER }
      );
      const client = new ImapFlow({ ...options, tls: { ca: cert } });
      client.on("error", () => undefined);
      const error = await client.connect().catch((e: unknown) => e);
      expect((error as { code?: unknown }).code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    });

    test("SMTP accepts the certificate of the host name", async () => {
      const port = await startTlsServer("220 fake ESMTP\r\n", smtpReply);
      const options = buildSmtpTransportOptions(
        { host: NAME, port, user: "u", password: "p", security: "tls", ca: cert },
        { host: "127.0.0.1", servername: NAME }
      );
      expect(await createTransport(options).verify()).toBe(true);
    });

    test("SMTP refuses a certificate for another name", async () => {
      const port = await startTlsServer("220 fake ESMTP\r\n", smtpReply);
      const options = buildSmtpTransportOptions(
        { host: OTHER, port, user: "u", password: "p", security: "tls", ca: cert },
        { host: "127.0.0.1", servername: OTHER }
      );
      const error = await createTransport(options)
        .verify()
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("does not match certificate's altnames");
    });
  });
  ```

- **Test** (`bash scripts/ci-bun.sh test apps/server/src/modules/mail/imap/tls-servername.test.ts`):
  1. "IMAP accepts the certificate of the host name": `connect()` and `logout()` resolve.
  2. "IMAP refuses a certificate for another name": the error `code` is `ERR_TLS_CERT_ALTNAME_INVALID`.
  3. "SMTP accepts the certificate of the host name": `verify()` resolves `true`.
  4. "SMTP refuses a certificate for another name": an `Error` whose message contains `does not match certificate's altnames`.
  5. The file reports `4 pass`, `0 fail`.
- **Check:** the Test command; `bunx eslint apps/server/src/modules/mail/imap/tls-servername.test.ts`.
- **Done when:** cases 1–5 hold.
- **Out of scope:** `client.ts`, `smtp.ts`, `host-guard.ts`; a test through `openImapProvider` or `verifySmtpLogin` (the test preload sets `allowLocal`, so the guard returns no `servername` there, `plan.md` F12 of F093); a test for an IP-literal IMAP host (F5: it fails before any certificate check).

## Step 4 — Comments and docs say the drift is closed

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

     The last item is plain text, exactly `- VPS: pending (F094 stage 2).`; stage 2 replaces it. Then rename `## Rule` to `## History (pin 1.3.14)` and keep its text. Keep `## Three Bun 1.3.14 behaviours …` and `## Effect on product code`; in the latter, change "fails the certificate name check on the image Bun" to "failed the certificate name check on the image Bun until F094" and append: "Corrected 2026-11-13 (F094): it also accepted a certificate issued for `localhost`." In `## Open`, mark NV3 `answered (see Closed)` and the follow-up ticket line `done: F094`.

  3. `docs/known-alerts.md`:
     - The AgentMail entry (heading starts with ``### `runSend > 3: a lost response is repeated with the same key` ``): after its `**Status:**` line, add this line:

       ```md
       - **Pin:** `.bun-version` is 1.4.4 since <step 1 commit> (F094). The fix stays: `stop()` must not wait for a held handler.
       ```

     - The STARTTLS entry (heading starts with ``### `STARTTLS against a scripted server with a self-signed certificate > `` ): in `**Fix:**`, change "the test certificate SAN is `IP:127.0.0.1,DNS:localhost` (F093 stage 1)" to "the test certificate SAN was `IP:127.0.0.1,DNS:localhost` (F093 stage 1); since F094 it is `IP:127.0.0.1` only, and a test refuses a `localhost` certificate for an IP host". Replace the "Product effect" sentence with: "Product effect until F094 (pin 1.3.14): STARTTLS to an IP-literal mail host failed the name check (fail-closed), and it accepted a certificate issued for `localhost` (fail-open). DNS names were fine. Since the 1.4.4 pin the check is against the IP." After its `**Status:**` line add this line:

       ```md
       - **Pin:** `.bun-version` is 1.4.4 since <step 1 commit> (F094); the image runs it after the VPS deploy of F094 stage 2.
       ```

     - No new entry. Statuses stay `fixed (…)`.

  4. `notes/2026-11-03-imapflow-tls-under-bun.md`: append one line at the end of the first list: `- Checked again 2026-11-13 on Bun 1.4.4 (F094 plan F5): the same error. The IMAP adapter never runs STARTTLS.`
  5. `deploy/README.md` line 62: "Each sync log line has the form `sync <mailbox id> <mode>: fetched …`." becomes "Each sync log line has the form `synced <mailbox id>: folders <n>, fetched <n>, …`; a failure is `sync <mailbox id> failed: …`." (`mail/jobs.ts:42-44`, `:85`).
  6. `bunx prettier --write` on the four Markdown files and `fake.ts`. Expect prettier to add one blank line in `notes/2026-11-03-imapflow-tls-under-bun.md` (that note already fails `prettier --check`; the pre-commit hook would do the same). That extra change is fine.

- **Test:**
  1. `grep -n "1.3.14" apps/server/src/modules/testmail/agentmail/fake.ts` shows only the new comment (with "waited").
  2. `grep -c "Closed (F094)" notes/2026-11-13-bun-version-drift.md` prints `1`; `grep -c "VPS: pending" notes/2026-11-13-bun-version-drift.md` prints `1`.
  3. `grep -c "is 1.4.4 since" docs/known-alerts.md` prints `2`.
  4. `grep -n "synced <mailbox id>" deploy/README.md` finds line 62.
- **Check:** `bunx prettier --check notes/2026-11-13-bun-version-drift.md notes/2026-11-03-imapflow-tls-under-bun.md docs/known-alerts.md deploy/README.md apps/server/src/modules/testmail/agentmail/fake.ts`; `bash scripts/ci-bun.sh test apps/server/src/modules/testmail` (the fake still passes).
- **Done when:** Tests 1–4 hold and the Check passes.
- **Out of scope:** `spec/build.md` (the coordinator changes TRACK at the land); `docs/product/**`; dated notes other than the two named; `CLAUDE.md`, the styleguide and `docs/code-patterns.md` (they name `.bun-version`, not a version).

## Stage done when

- Steps 1–4 are done and committed (explicit paths; one commit per step is fine).
- The final message lists: the step 1 commit hash; the counts of step 2 case 5 (on 1.3.14); the image check result or why it could not run; any command that touched `bun.lock`.
- The stage 1 Proof of `plan.md` § Proof prints `PROOF_OK`, run after the last commit with nothing after it; `/tmp/f094-s01/*.log` hold the passes.
