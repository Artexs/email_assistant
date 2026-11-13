# F093 stage 01 — Bun pin, the AgentMail fake and the STARTTLS fake

Part of [`../plan.md`](../plan.md). Not `[risky]`. Review before the land (it touches the STARTTLS security test).

Goal of the stage: `bun run test:unit:ci` (unit tests on Bun 1.3.14, the CI and image version) passes with 0 fail. Today five tests hang there (plan F2). Four steps, about 200 changed lines.

Read first: `plan.md` § "Differences found at collect", F4–F8, D5–D9, "Rules for every stage".

## Step 1 — One Bun pin (D5, D6)

**Goal:** CI, the image check and the agents' `:ci` scripts read one file.

**Files:**

- New `.bun-version`: one line `1.3.14` and a newline.
- New `scripts/ci-bun.sh` (mode 755, like `scripts/limen-prepare.sh`):

  ```bash
  #!/usr/bin/env bash
  # Runs bun at the version that CI and the server image use (.bun-version), through bunx.
  set -euo pipefail
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  version="$(tr -d '[:space:]' < "${root}/.bun-version")"
  exec bunx "bun@${version}" "$@"
  ```

- `package.json` `scripts`, after `test:int`: `"test:unit:ci": "bash scripts/ci-bun.sh run test:unit"`, `"test:int:ci": "bash scripts/ci-bun.sh run test:int"`. No other change in `package.json`.
- `.github/workflows/ci.yml`: in both `oven-sh/setup-bun@v2` steps (jobs `ci` and `e2e`) replace `bun-version: 1.3.14` with `bun-version-file: .bun-version`. In job `image`, after `actions/checkout@v4` and before `Build the server image`, add:

  ```yaml
      - name: Check that the image uses the pinned Bun
        run: test "FROM oven/bun:$(tr -d '[:space:]' < .bun-version)" = "$(head -n 1 deploy/Dockerfile)"
  ```

**Interfaces:** `bash scripts/ci-bun.sh <bun args>` = `bun@<pin> <bun args>`. `bun run test:unit:ci`, `bun run test:int:ci`.

**Decisions:** D5, D6. Do not touch `deploy/Dockerfile` or `bun.lock`.

**Test:**

1. `bash scripts/ci-bun.sh --version` prints exactly `1.3.14`.
2. The image check command from the YAML, run in the repo root, exits 0.
3. `test "FROM oven/bun:9.9.9" = "$(head -n 1 deploy/Dockerfile)"` exits 1 (the check can fail).
4. `grep -c "bun-version-file: .bun-version" .github/workflows/ci.yml` prints `2`; `grep -c "bun-version: " .github/workflows/ci.yml` prints `0`.
5. `bun run test:unit:ci` runs (it still shows the five failures of F2 until steps 2 and 3).

**Check:** the commands of tests 1–4; `git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock`.

**Done when:** tests 1–4 hold; commit `F093 s1: one Bun pin for CI, the image check and the :ci scripts`.

**Out of scope:** the Bun upgrade (questions.md Q1); the rule text (stage 3).

## Step 2 — The AgentMail fake releases held responses on stop (D7, D8)

**Goal:** `fake.stop()` returns at once on 1.3.14 while a response is held. Cause (F5): `stop()` clears the hold timer, so the held handler never resolves, and Bun 1.3.14 `server.stop(true)` waits for it.

**Files:** `apps/server/src/modules/testmail/agentmail/fake.ts`, `apps/server/src/modules/testmail/agentmail/fake.test.ts`.

**Interfaces:** `FakeAgentMail` does not change. Inside `startFakeAgentMail`: replace `timers` (a `Set` of timer ids) with a set of held waits, each with its timer and a `release()` that clears the timer, removes the entry and resolves the wait. `wait(ms)` adds an entry whose timer calls `release()`. `stop()` first calls `release()` on a copy of every entry, then `await server.stop(true)`. Probed shape (plan F5):

```ts
const held = new Set<{ timer: ReturnType<typeof setTimeout>; release: () => void }>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const entry = {
      timer: setTimeout(() => entry.release(), ms),
      release: () => {
        clearTimeout(entry.timer);
        held.delete(entry);
        resolve();
      },
    };
    held.add(entry);
  });
}
// stop(): for (const entry of [...held]) entry.release(); await server.stop(true);
```

Change the doc comment of `holdResponseNext` in the interface: add "`stop()` releases a held response at once; the answer goes to a closed connection."

**Decisions:** D8. Do not change `holdResponseNext` call sites or the 1000 ms holds in the tests: the client times out after 200 ms, and `stop()` now ends the hold.

**Test** (in `fake.test.ts`, `describe("AgentMail fake")`):

1. Existing `holdResponseNext: the client times out, the mail is stored, a repeat returns the stored id` passes on the pinned Bun, under 1 s.
2. New `stop releases a held response at once`: start a second fake `other` (as the test `stop closes the port` does), `other.holdResponseNext("send", 10_000)`, call `send` through a client with `timeoutMs: 200` and expect a `SoftError`; then `const started = Date.now(); await other.stop();` and expect `Date.now() - started` to be below `1000`.
3. Existing `stop closes the port` passes.
4. `apps/server/src/modules/testmail/send.test.ts` test `3: a lost response is repeated with the same key` passes on the pinned Bun with no change in that file.

**Check:** `bash scripts/ci-bun.sh test apps/server/src/modules/testmail/agentmail/fake.test.ts apps/server/src/modules/testmail/send.test.ts` → 0 fail; the same with `bun test` (local Bun) → 0 fail.

**Done when:** both commands show 0 fail; commit `F093 s1: the AgentMail fake releases held responses on stop`.

**Out of scope:** `client.ts`, `send.ts` (product code).

## Step 3 — The STARTTLS fake server works on Bun 1.3.14 (D7, D9)

**Goal:** the four tests of `describe("STARTTLS against a scripted server with a self-signed certificate")` pass on 1.3.14 and 1.4.4 with every assertion unchanged.

Causes: F6 (Bun 1.3.14 cannot finish a server-side `new TLSSocket(socket, { isServer: true })`) and F7 (a Bun 1.3.14 client that upgrades a socket to an IP host checks the certificate against `localhost`).

**Files:** `apps/server/src/modules/mail/imap/smtp-starttls.test.ts` only.

**Interfaces:** `startServer(opts: { offerStartTls: boolean }): Promise<Fake>` keeps its signature and its `seen` values. Inside:

- Move the command handler `handle(socket, tls)` out of the `createServer` callback to the `startServer` scope, so two servers share it and its `seen`.
- Create `tlsServer = createServer` from `node:tls` (import it as `createTlsServer`) with `{ key, cert }` and the callback `(socket) => handle(socket, true)`. Listen on `0, "127.0.0.1"` first; keep its port in `tlsPort`; then listen with the plain `node:net` server and resolve with the plain port.
- At `STARTTLS` (when offered): `seen.push("STARTTLS")`, `socket.removeAllListeners("data")`, `socket.pause()`, then `const inner = connect(tlsPort, "127.0.0.1", () => { socket.write("220 2.0.0 ready\r\n"); socket.pipe(inner); inner.pipe(socket); socket.resume(); })` (`connect` from `node:net`), `inner.on("error", () => undefined)`, `return`. The `220` goes out only after the relay is connected, so the client's TLS hello cannot arrive before the pipe.
- Push both servers to `servers` (the type becomes `(Server | TlsServer)[]`, or two arrays); `afterAll` closes both.
- Remove the `TLSSocket` import if nothing uses it (keep `type TLSSocket` for the `handle` parameter if needed).
- Certificate: the `openssl` `-addext` value becomes `subjectAltName=IP:127.0.0.1,DNS:localhost`. Add a comment above it: Bun 1.3.14 (`.bun-version`) checks a socket upgraded to an IP host against `localhost`; the DNS name lets the test run there; remove `DNS:localhost` when `.bun-version` moves past 1.3. Extend the file's top comment by one sentence: at `STARTTLS` the plain server relays the connection to a second, TLS-only server, because Bun 1.3.14 cannot upgrade an accepted socket on the server side.

A probed copy of the whole file with these changes passed 9/9 on both versions (plan F7).

**Decisions:** D9. Do not change `smtp.ts`, `host-guard.ts` or `apps/server/test/preload.ts`.

**Test:**

1. `verifySmtpLogin upgrades first and logs in only inside TLS when the certificate is trusted`: `seen` equals `["STARTTLS", "AUTH tls"]` (unchanged).
2. `openSmtpSender sends after the upgrade`: `seen` equals `["STARTTLS", "AUTH tls", "MAIL", "DATA"]` (unchanged).
3. `an untrusted certificate is refused and no password goes out`: `HardError`, `seen` equals `["STARTTLS"]`, the send error matches `{ stage: "connect", soft: false }`, no `AUTH` (unchanged).
4. `a server without STARTTLS is refused and no password goes out`: `seen` equals `[]` (unchanged).
5. The five `buildSmtpTransportOptions with STARTTLS` tests pass (unchanged).

**Check:** `bash scripts/ci-bun.sh test apps/server/src/modules/mail/imap/smtp-starttls.test.ts` → 9 pass, 0 fail, under 5 s; `bun test apps/server/src/modules/mail/imap/smtp-starttls.test.ts` → 9 pass. `git diff` of the file shows no change inside any `expect(…)` line.

**Done when:** both runs pass; commit `F093 s1: the STARTTLS test server relays to a TLS server (Bun 1.3.14)`.

**Out of scope:** the F7 quirk in product code (Q1 follow-up); IMAP STARTTLS (NV3).

## Step 4 — Alert entries and the note

**Goal:** the next agent finds the true cause.

**Files:** `docs/known-alerts.md`, new `notes/2026-11-13-bun-version-drift.md`.

- `docs/known-alerts.md`, entry `` `runSend > 3: a lost response is repeated with the same key` and `AgentMail fake > holdResponseNext: … ^ this test timed out after 5000ms` ``: replace **Cause** with: Bun 1.3.14 (CI and the image) `server.stop(true)` waits for in-flight handlers; the fake's `stop()` cleared the hold timer, so the held handler never ended and `afterEach` hung (log line `a beforeEach/afterEach hook timed out for this test`). Local runs used Bun 1.4.4, where `stop(true)` returns at once. Replace **Fix** with: the fake's `stop()` releases held responses (F093 stage 1); run `bun run test:unit:ci` to test on the CI Bun. **Status:** `fixed (<commit of step 2>)`.
- Add an entry after it, same shape: heading `` `STARTTLS against a scripted server with a self-signed certificate > … ^ this test timed out after 5000ms` ``; First seen 2026-11-12 (CI, `test:unit`); Source `apps/server/src/modules/mail/imap/smtp-starttls.test.ts`; Cause F6 and F7 in one or two sentences; Fix: the relay and the SAN (F093 stage 1); Status `fixed (<commit of step 3>)`.
- The note (plain technical English, short lines): CI and the image run the Bun in `.bun-version`; local and worker runs use the PC's Bun (1.4.4 on 2026-11-13); `bun run test:unit:ci` / `test:int:ci` run on the pin (F8). The three 1.3.14 behaviours: F5, F6, F7, each with one line and the probe result. F7 effect on product: STARTTLS to an IP-literal mail host fails the name check on the image runtime; DNS names are fine (servername from the host guard). NV3 open. Pointer to `spec/features/active/F093-ci-green/plan.md` and to questions.md Q1.

**Test:** none (docs). Check: `grep -n "fixed (" docs/known-alerts.md` shows both entries with a commit id.

**Done when:** commit `F093 s1: alerts and note on the Bun version drift`.

## Stage done when

- Steps 1–4 are committed.
- `bash scripts/ci-bun.sh test apps/server/src/modules/testmail apps/server/src/modules/mail/imap/smtp-starttls.test.ts` shows 0 fail.
- The Proof of `plan.md` § Proof, stage 1 form, prints `PROOF_OK`:

  ```
  mkdir -p /tmp/f093-s01 && bun run lint > /tmp/f093-s01/lint.log 2>&1 && bun run typecheck > /tmp/f093-s01/typecheck.log 2>&1 && test "$(bash scripts/ci-bun.sh --version)" = "$(tr -d '[:space:]' < .bun-version)" && bun run test:unit:ci > /tmp/f093-s01/unit-ci.log 2>&1 && bun run test:int > /tmp/f093-s01/int.log 2>&1 && git diff --exit-code "$(git merge-base HEAD master)" -- bun.lock deploy/Dockerfile && echo PROOF_OK
  ```

- The final message lists: the unit-ci totals line from `/tmp/f093-s01/unit-ci.log` (expected about 1874 pass, 0 fail), the int totals, and any test that failed and why.
