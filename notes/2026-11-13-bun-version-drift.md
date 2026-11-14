# Bun version drift: closed by the 1.4.4 pin (2026-11-13)

Plan: `spec/features/active/F093-ci-green/plan.md`.

## Closed (F094)

- `.bun-version` and `deploy/Dockerfile` line 1 hold Bun 1.4.4, the PC's Bun. CI reads the pin; the `image` job checks the Dockerfile. `bun run test:unit:ci` and `bun run test:int:ci` stay the proof scripts (they run the pin).
- Commit: `daea2dc`.
- The STARTTLS test certificate names only `IP:127.0.0.1`. A new test refuses a trusted certificate for `localhost` on STARTTLS to 127.0.0.1. On 1.3.14 that test fails: 1.3.14 checked the upgrade against `localhost`, so it refused a correct IP certificate (fail-closed) and accepted a `localhost` certificate (fail-open). 1.4.4 checks against the IP.
- NV3 answered: the IMAP adapter never runs STARTTLS (`imapFlowOptions`: implicit TLS for every non-loopback host; `doSTARTTLS: false` for plain loopback). imapflow over TLS to any IP-literal host throws `servername argument must be an string` on Bun 1.3.14 and 1.4.4 (imapflow passes `servername: false`); see `notes/2026-11-03-imapflow-tls-under-bun.md`. It fails closed; mailbox hosts must be DNS names.
- VPS: pending (F094 stage 2).

## History (pin 1.3.14)

- CI and the server image run the Bun version in `.bun-version` (1.3.14).
- Local and worker runs use the PC's Bun (1.4.4 on 2026-11-13).
- `bun run test:unit:ci` and `bun run test:int:ci` run the tests on the pinned version (`scripts/ci-bun.sh`, through `bunx bun@<version>`).
- The `image` job in `ci.yml` checks that `deploy/Dockerfile` line 1 is `FROM oven/bun:<.bun-version>`.

## Three Bun 1.3.14 behaviours (all fixed in the tests, none in product code)

1. `server.stop(true)` waits for in-flight handlers. The AgentMail fake cleared its hold timer on `stop()`, so the handler never ended. Probe: `stop(true)` pending after 3 s on 1.3.14, 0 ms on 1.4.4. Fix: `stop()` releases each held wait first.
2. A server-side `new TLSSocket(socket, { isServer: true, key, cert })` on an accepted `node:net` socket never finishes the handshake. Same with `secureContext` and `tls.createServer`. Node is fine. Fix in the STARTTLS test: relay the socket to a TLS-only `tls.createServer`.
3. A client `tls.connect({ socket, host: "127.0.0.1", ca })` (STARTTLS upgrade to an IP host, no `servername`) checks the certificate against `localhost`. Implicit TLS to an IP is correct. With a DNS name the host guard sets `servername`, so that works. Test fix: the SAN holds `IP:127.0.0.1,DNS:localhost`. Remove `DNS:localhost` when `.bun-version` moves past 1.3.

## Effect on product code

STARTTLS to an IP-literal mail host failed the certificate name check on the image Bun until F094 (`host-guard.ts` returns no `servername` for an IP literal). It failed closed: no password went out. DNS hosts are fine. Corrected 2026-11-13 (F094): it also accepted a certificate issued for `localhost`.

## Open

- NV3: whether IMAP STARTTLS (imapflow) to an IP host has the same quirk. Answered (see Closed).
- Done: F094. The coordinator opens the follow-up ticket after the stage 1 land: "The server image, CI and local checks run one current Bun (1.4.x)" (plan § How to run, item 5; questions.md Q1).
