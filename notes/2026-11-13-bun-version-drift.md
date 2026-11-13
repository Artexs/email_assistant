# Bun version drift: CI and image on 1.3.14, local on 1.4.4 (2026-11-13)

Plan: `spec/features/active/F093-ci-green/plan.md`.

## Rule

- CI and the server image run the Bun version in `.bun-version` (1.3.14).
- Local and worker runs use the PC's Bun (1.4.4 on 2026-11-13).
- `bun run test:unit:ci` and `bun run test:int:ci` run the tests on the pinned version (`scripts/ci-bun.sh`, through `bunx bun@<version>`).
- The `image` job in `ci.yml` checks that `deploy/Dockerfile` line 1 is `FROM oven/bun:<.bun-version>`.

## Three Bun 1.3.14 behaviours (all fixed in the tests, none in product code)

1. `server.stop(true)` waits for in-flight handlers. The AgentMail fake cleared its hold timer on `stop()`, so the handler never ended. Probe: `stop(true)` pending after 3 s on 1.3.14, 0 ms on 1.4.4. Fix: `stop()` releases each held wait first.
2. A server-side `new TLSSocket(socket, { isServer: true, key, cert })` on an accepted `node:net` socket never finishes the handshake. Same with `secureContext` and `tls.createServer`. Node is fine. Fix in the STARTTLS test: relay the socket to a TLS-only `tls.createServer`.
3. A client `tls.connect({ socket, host: "127.0.0.1", ca })` (STARTTLS upgrade to an IP host, no `servername`) checks the certificate against `localhost`. Implicit TLS to an IP is correct. With a DNS name the host guard sets `servername`, so that works. Test fix: the SAN holds `IP:127.0.0.1,DNS:localhost`. Remove `DNS:localhost` when `.bun-version` moves past 1.3.

## Effect on product code

STARTTLS to an IP-literal mail host fails the certificate name check on the image Bun (`host-guard.ts` returns no `servername` for an IP literal). It fails closed: no password goes out. DNS hosts are fine.

## Open

- NV3: whether IMAP STARTTLS (imapflow) to an IP host has the same quirk. Not checked.
- The coordinator opens the follow-up ticket after the stage 1 land: "The server image, CI and local checks run one current Bun (1.4.x)" (plan § How to run, item 5; questions.md Q1).
