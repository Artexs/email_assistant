FAIL 6222d69dfb7366a9b373b82339ce929c4e1c7659

HEAD matches the candidate (`git rev-parse HEAD` → 6222d69d…). The diff 4f653db8..HEAD changes only files in `spec/features/active/F119-e7-t7-identity-b-oidc/`.

## Blocking

**B1. Stage 07 cannot pass its own tests. Two rules conflict, and C1 was applied only to stages 02 and 03.** Proven by reading the text and the repo.
- Rule A: the CLI refuses an `http:` issuer. `stage-07-org-sso-provider.md:31` says `--issuer <https url>`. Test 6 (`:41`) says "an `http://` issuer → usage, exit 1". `plan-refresh-1.md:50` (D18 point 3) uses this refusal as one reason that D18 is safe in production.
- Rule B: tests 1–5 and 7 run "the fake IdP as issuer, its origin in `allowOrigins`" (`:34`). The fake IdP issuer is `http://127.0.0.1:<port>` (`plan.md:27` D17, `stage-03-plugin.md:13`). Test 5 uses `--confirm` (`:40`) and test 7 uses stdin (`:42`), so both go through the CLI argument parser. Rule A then refuses them.
- No interface gets `allowOrigins` into the CLI. Every existing org CLI test starts the script as a subprocess (`apps/server/test/integration/org-flag-cli.test.ts:29-36`, `Bun.spawn`). No script in `apps/server/src/scripts/` has an in-process entry with deps (only `testmail-remote.ts:247` uses `import.meta.main`). So a Sonnet worker must guess. The likely guess is an env var or flag that trusts an origin and allows `http:`. That switch would also exist in production, and it would remove the guard that D18 point 3 depends on.
- `spike.md` C1 says "Touches stages 02 and 03 only". Before the refresh, the old CHECK hid this conflict. With D18 it is now active.
- Fix: write the decision into stage 07. For example: `runOrgSso(argv, { stdin, allowOrigins, lookup, resolveTxt })` is called in-process by tests, and the script entry always passes `allowOrigins: []`. The parser accepts `http://127.0.0.1:<port>` only when that origin is in `allowOrigins`. Stage 08 already expects in-process injection ("tests inject a fake" `resolveTxt`, `stage-08-domain-and-require.md:17`). Add an args test: `http://127.0.0.1:<port>` with empty `allowOrigins` → exit 1.

## Unverified

- I did not run the D18 CHECK in Postgres. No DB container was running and the worktree has no `.env`. A JS regex with the same pattern (`bun -e`) gives what stage 02 test 2 expects: `http://127.0.0.1:4000` passes. `http://127.0.0.1`, `:4000/x`, `:4000/`, `localhost:4000`, `10.0.0.1:4000` and `idp.x.test` are refused. Postgres regex semantics are assumed, not proven.
- I ran no test suites. The candidate changes only plan files, so no suite can tell a good candidate from a bad one.

## D18 verdict (safe in production; proven from the plugin source, with one plausible dependency)

- The issuer is never fetched at sign-in. Sign-in fetches go to the stored endpoints, and each fetch runs `assertOIDCEndpointAllowed` with `ctx.context.isTrustedOrigin` (token `index.mjs:3894`, jwks `:3921`, userinfo `:3935`). That function checks the literal host, resolves the name in DNS (`:478-503`) and uses `redirect: "manual"` (`:550`). A stored config with missing endpoints runs discovery at runtime against Better Auth `trustedOrigins` (`:771-790`). That discovery fails closed because `validateDiscoveryUrl` (`:394-397`) needs a trusted origin. So the CHECK only guards the shape, and the `http://127.0.0.1` form adds no fetch path. Path: `~/.cache/.bun/install/cache/@better-auth/sso/1.7.18@@@1/dist/index.mjs`.
- Plausible (note): "trustedOrigins lists no IdP" (`plan.md:28`) depends on the operator. Production `trustedOrigins` is `baseUrl.origin` plus `WEB_TRUSTED_ORIGINS` (`apps/server/src/web.ts:328`). `.env.example:95` ships `http://127.0.0.1:8080,http://localhost:8080`, and the server listens on 8080 (`stage-14-vps.md:19`). `deploy/README.md:163` tells the operator to empty this key, but no stage 14 check proves it. If the key is not empty, a row whose endpoints are on `http://127.0.0.1:8080` gets fetched. Only a writer with direct DB access can make such a row, so this is not blocking. Recommendation: add a stage 14 check that `WEB_TRUSTED_ORIGINS` is empty, or name this dependency in D18.

## C3 verdict (complete for the discovery fetch)

- Our predicate returns true for the URL. Then the plugin skips `assertEndpointResolvesPublic` (`index.mjs:480`). Discovery fetches only the discovery URL (`:598-603`), on the issuer host, and does not follow redirects (`oidc_endpoint_redirect`, `:529-536`). So "resolve the issuer host before discovery" (`stage-07…:13`) closes the gap. The check of each endpoint after discovery is extra safety, because sign-in checks those endpoints again (above). The rebinding window is recorded as accepted (D10). A trailing dot (`localhost.`, `idp.internal.`) gets past the name rule of the predicate (`new URL("https://localhost./").hostname` → `localhost.`), but the DNS lookup still catches it.

## Notes

- **N1 (plausible, missing decision): the address ranges.** `stage-07…:13` says "IANA special-purpose ranges, IPv4-mapped forms too". The repo already has `isLocalAddress` (`apps/server/src/modules/mail/host-check.ts:41`), `LookupAll` and `dnsLookupAll` (`host-guard.ts:9,22`). That list also refuses NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compatible `::/96` and `100.64/10`. The IANA registry marks `64:ff9b::/96` as globally reachable. A worker who follows the IANA wording would therefore allow a NAT64 form of `10.0.0.1`. Decide: reuse that guard (it may move to `platform/`), or list the ranges. Then add a NAT64 case to test 8.
- **N2 (proven by text, missing test):** `discovery_dns_failed` (a lookup error, `stage-07…:13`) has no case in test 8 (`:43`). Add: fake `lookup` throws `ENOTFOUND` → exit 1 `discovery_failed discovery_dns_failed`, no row.
- **N3 (proven by diff):** the refresh removed two predicate cases from stage 07 test 8: `https://127.0.0.1` and `https://169.254.169.254`. `plan-refresh-1.md:39` says "no decision, test or interface removed". `https://10.0.0.1` still covers IP literals, but the claim is wrong and the metadata-address case is gone.
- **N4 (proven from the source, edge case):** stage 03 test 10 (`stage-03-plugin.md:50`) asks for "the log reason is `state_mismatch` (a new `BETTER_AUTH_REASONS` entry)". `BETTER_AUTH_REASONS` matches the start of the logger message (`apps/server/src/platform/auth.ts:126-139`). For every state failure the message is `"Failed to parse state"` (`better-auth@1.7.18/dist/oauth2/state.mjs:51`). That covers `state_not_found`, `state_invalid`, `state_mismatch` and internal errors. The SSO plugin calls this `parseState` (`sso index.mjs:3819, 4202`). So one entry gives the label `state_mismatch` to every state failure. Decide on a generic reason (for example `oauth_state_failed`), or on a reason taken from the `error_code` field. The comment at `auth.ts:126` also says that entries come from `docs/known-alerts.md`, and no stage adds that row.
- **N5 (plausible, missing test):** S4 shows that `/two-factor/disable` also makes a new session from the current SSO session, and C5 shows the hook data there. Stage 05 test 5 (`stage-05-sso-session.md:43`) covers only TOTP turn-on and `/change-password`. Add `/two-factor/disable` to test 5.
- **N6 (plausible, rule conflict, board drift; I did not repair it):** `plan.md:68` says "G1: passed by the coordinator" and cites "owner checkpoints are not a stop". But `docs/product/stage-2/05-execution-plan.md:58` lists F119's gate as "second pass after it (PD-040, PD-041)". §2.4 (`:127`) says "A ticket with a second-pass gate on a later stage builds up to that stage, then stops and asks the owner for the second pass". `spec/build.md:34` narrows this to "a second-pass gate on numbers", so the two rules disagree for a spike-based second pass. The E7 row (`05-execution-plan.md:156`) still says "decided, second pass after OIDC spike". `docs/owner-decisions.md` has no entry for "G1 passed on a default" (`spec/build.md:38` requires one for each checkpoint passed on a default). The coordinator should either record the entry or ask the owner.
- **N7 (minor, fact source):** `plan.md:28` D18 says "`org:sso` refuses IP literals (D10)". D10 (`plan.md:21`) does not mention IP literals. The rule is in the stage 07 predicate (`stage-07…:12`).
- **N8 (size):** `wc -w` gives plan 1,498 (`plan.md:106` says 1,499) and stage 07 exactly 700, at the limit. If the B1 fix adds text, stage 07 can go over 700. Then split it: 07a discovery and service, 07b the CLI.

## Checks run

- `git rev-parse HEAD` → `6222d69dfb7366a9b373b82339ce929c4e1c7659` (match).
- `git diff 4f653db8..HEAD --stat` and the full diff of the stages, `ticket.md` and `questions.md`: 10 files, all in the F119 folder.
- I read the `@better-auth/sso@1.7.18` and `better-auth@1.7.18` source from the bun cache (lines cited above).
- `bun -e` JS-regex proxy of the D18 CHECK (results above; a proxy, not Postgres).
- `wc -w` of `plan.md` and the stages (above).
- No unit, integration or e2e suite was run (the diff changes only plan files).

## Note check

- HEAD is 6222d69d…: proven. `git rev-parse HEAD` (a single command, exit 0, output 6222d69dfb7366a9b373b82339ce929c4e1c7659).
- C1–C5 map to complete, consistent stage edits: proven, with the result "not complete". `git diff 4f653db8..HEAD -- spec/features/active/F119-e7-t7-identity-b-oidc/stages spec/features/active/F119-e7-t7-identity-b-oidc/ticket.md spec/features/active/F119-e7-t7-identity-b-oidc/questions.md` (a single command, exit 0). The C1 gap in stage 07 is B1.
- D18 safety and C3 completeness judged with file:line evidence: proven. `/home/artek/.cache/.bun/install/cache/@better-auth/sso/1.7.18@@@1/dist/index.mjs` (lines 394-560, 771-790, 3894, 3921, 3935) and `apps/server/src/web.ts` (line 328). The Postgres run of the CHECK is not proven: only a JS-regex proxy ran.
- Final message format (first line `FAIL <sha>`, file:line, labels): proven. This message.
- Easy-to-miss rule (missing code detail is not a finding): followed. Each finding in this message names a missing decision (B1, N1, N4, N6), test (N2, N3, N5), interface (B1) or fact source (N7). None of them asks for line numbers, edit text or file lists.
