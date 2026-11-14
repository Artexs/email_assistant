# F119 plan — Identity B (OIDC)

> **Status 2026-11-14 — planned.** Plan base: 69473f4e. 15 stages; gate G1 after stage 01.

## Input

- Planning job: "owner steps are not a stop: plans use the defaults."
- Owner (2026-11-13, "go with the default values"): PD-040, PD-041, PD-043, PD-045 (`docs/product/stage-2/decisions.md`); ADR 0026 points 2–9; F105 D27 (an SSO callback skips the TOTP step).

### Decisions

- **D1 Package.** `@better-auth/sso` exactly 1.7.18, imported only in `platform/auth-sso.ts`. Rejected: 1.7.22 (the core stays 1.7.18).
- **D2 HTTP surface.** The allow-list adds `POST /sign-in/sso` and `GET /sso/callback/<providerId>`; every other plugin path answers 404; `providersLimit` is 0 (W1, W3). Rejected: the plugin's provider and domain endpoints (user-made providers).
- **D3 Plugin options.** `domainVerification.enabled`, `disableImplicitSignUp`, `resolveUser` (D5), an `errorURL`, a body allow-list on `/sign-in/sso`; no IdP token stored (F8); no `trustEmailVerified`, provisioning or SAML.
- **D4 Schema** (stage 02): `sso_providers`, `organizations.sso_required`, `auth_sessions.sign_in_method` and `sso_started_at`, trigger `auth_sessions_sso_cap`.
- **D5 Member resolution** (stage 04): only an existing member whose oldest membership is the provider's organization, on its domain (Google: `hd`), with the flag on. Rejected: `disableImplicitSignUp` alone (W2).
- **D6 SSO session** (stage 05): a callback session is `sso` and ends 12 h after `sso_started_at`; a session made from it inherits both (F9); the trigger keeps the cap through refreshes (F5).
- **D7 TOTP and SSO** (F105 D27, option "mark SSO sessions"): an SSO sign-in asks no TOTP code (the IdP owns its second factor); the operator console refuses an SSO session. Rejected: a code step after the callback (a second copy of the plugin's challenge).
- **D8 SSO required** (stage 06): a refused password sign-in looks like a wrong password, without lockout count or mail; the reset request gives the generic answer; the break-glass owner with TOTP passes; only the operator reopens passwords (`--require off`, a provider removal or a new issuer or domain). Rejected: an `SSO_REQUIRED` code (user enumeration, F082 B1).
- **D9 Domain proof** (stage 08): our own TXT record with a keyed-hash token; no stored token. Rejected: the plugin's verify endpoint (user session; W4).
- **D10 `org:sso`** (stages 07–08) and **D11 `org:member`** (stage 09): operator CLIs. The client secret comes from stdin only. ADR 0026 point 7 "the owner can end a member's sessions": the operator does it on the owner's request in Stage 2.
- **D12 Audit**: `sso.*`, `org.member_added`, `web.member_sessions_ended`; ids, codes, domains, counts. Our resolver's refusals get a row; plugin failures and refused passwords a log line.
- **D13 Flag `sso_sign_in`** (E7-T7, default off, remove by 2027-06-01): off → the callback rejects (`sso_off`) and `GET /api/sign-in-options` says `sso: false`.
- **D14 Web** (stages 10–12): company sign-in only when a usable provider exists; no password, TOTP or delete controls without a password; a read-only console block.
- **D15 Secrets.** Client secret, IdP tokens, `id_token`, codes and the IdP e-mail never reach a log line, error, audit row, stdout or snapshot. The client secret stays in clear in `sso_providers.oidc_config` (the plugin reads the row; no read hook) and is never exported (Q1).
- **D16 Edge cases.** One user has one SSO identity; the tenant stays the oldest membership. A CLI write is one transaction that locks the organization row; discovery and DNS run before it; a repeat writes nothing. A callback locks the provider row, so a removal waits and then ends that session. A crash after the callback commit can lose one `sso.login` row (accepted). Tests move `sso_started_at` with SQL, never the clock.
- **D17 Fake IdP** `apps/server/test/fake-oidc.ts` (stage 03): `node:crypto` RS256 on `Bun.serve`; no new dependency.

## Owner decisions (defaults taken; `questions.md`)

Q1 client secret in clear · Q2 SSO skips TOTP; operators use a password · Q3 operator ends member sessions · Q4 new `org:member` · Q5 refusal like a wrong password · Q6 public `GET /api/sign-in-options` · Q7 `--require on` prerequisites · Q8 one domain, no subdomains · Q9 no Playwright spec · Q10 Entra tenant = the F117 M365 seat.

## Facts

[facts.md](facts.md): F1–F10 from the plugin source; the spike (stage 01) checks the rest.

## Done when

1. A member signs in through the fake IdP; the session is `sso` and ends 12 h after `sso_started_at`, also after a refresh or a derived session [03–05].
2. A non-member, an off-domain e-mail, an identity bound to another user, the flag off and `requestSignUp: true` make no user, link or session, and one `sso.refused` row [04].
3. Plugin paths outside D2 answer 404; no user can create a provider [03].
4. "SSO required" refuses member passwords and resets like a wrong password; the break-glass owner with TOTP passes [06].
5. An operator with an SSO session gets `403 password_sign_in_required` [05].
6. `org:sso` and `org:member` do every command of D10, D11; prerequisites exit 1 [07–09].
7. Web texts in pl and en [10–12]; docs and ADR 0026 [13]; VPS [14]; Entra [15].
8. No secret of D15 in logs, audit rows, stdout or snapshots (log capture in stages 03–09).

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, `ticket.md`, this file, `facts.md` and your stage file. Build only your stage. Format only your files.
- Secrets: D15. Test addresses end in `@x.test`; test domains are `x.test`, `y.test`. No tailnet name or VPS address in a file.
- Better Auth rate limits: every test request has a fresh `x-client-ip` (`nextIp()`).
- `@better-auth/sso` only in `platform/auth-sso.ts`; tenancy never imports Better Auth (F105 D4).
- Only stage 02 adds a migration; only stage 03 changes `bun.lock`. Any other need: stop and ask.
- A changed type: fix every caller and fake in the same stage.
- `git add <paths>`, never `-A`; review `git diff --staged`.
- A gap or a deviation is a question in your final message, not a choice.

## Proof

Server stages (02–09), NN = stage number:

```
mkdir -p /tmp/f119-sNN && bun run lint > /tmp/f119-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f119-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f119-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f119-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (10–12): add `&& bun run web:build > /tmp/f119-sNN/web.log 2>&1` before `echo`. Stages 01, 13–15: their stage file. One bash call after the last commit.

## Owner checkpoints and steps

- **G1 (gate) after stage 01:** second pass on `spike.md` (PD-040, PD-041). All PASS → expected "go"; a FAIL changes ADR 0026 points 2–5 and this plan.
- **U1 (stage 15):** the owner opens the Entra test tenant (Q10), registers an app, makes test users and pastes the client secret into `org:sso --set --client-secret-stdin`. No agent reads it.
- After stage 02 lands: `bun run db:migrate` in the main checkout.

## Review

Review job before the land: stages 02–11 (auth, migration, tenant data, a public route, Polish texts), model `claude-opus-5-5`. Stages 12, 13 land on the worker's proof.

## Stages

| # | Stage | Needs | Mark |
| - | ----- | ----- | ---- |
| 01 | [Spike](stages/stage-01-spike.md) | — | `[risky]`, gate G1 |
| 02 | [Migration](stages/stage-02-migration.md) | G1 | `[risky]` migration |
| 03 | [Plugin, allow-list, fake IdP](stages/stage-03-plugin.md) | 02 | `[risky]` auth, `bun.lock` |
| 04 | [Member resolution and SSO audit](stages/stage-04-resolve-member.md) | 03 | `[risky]` auth |
| 05 | [SSO session: mark, 12 h, operator](stages/stage-05-sso-session.md) | 04 | `[risky]` auth |
| 06 | [SSO required](stages/stage-06-sso-required.md) | 05 | `[risky]` auth |
| 07 | [`org:sso` set, show, remove](stages/stage-07-org-sso-provider.md) | 04 | `[risky]` security |
| 08 | [Domain proof and the require switch](stages/stage-08-domain-and-require.md) | 06, 07 | `[risky]` security |
| 09 | [`org:member`](stages/stage-09-org-member.md) | 05, 07 | `[risky]` tenant data |
| 10 | [Read surfaces, security-log kinds](stages/stage-10-read-surfaces.md) | 08, 09 | |
| 11 | [Login page](stages/stage-11-login-page.md) | 10 | review |
| 12 | [Account card, console block](stages/stage-12-account-console.md) | 10 | |
| 13 | [Docs and ADR](stages/stage-13-docs.md) | 11, 12 | |
| 14 | [VPS deploy](stages/stage-14-vps.md) | 13 | `[risky]` real system |
| 15 | [Entra check](stages/stage-15-entra.md) | 14, U1 | `[risky]` real system |

Parallel: 07 ∥ 05–06; 09 ∥ 06, 08; 11 ∥ 12.

## How to run (coordinator)

1. Before stage 01: F105 in `done/`; `scripts/plan-drift.sh <folder> 69473f4e` (exit 1 → refresh job); move the folder to `active/`; commit.
2. Spawn each stage with the worker command of `spec/build.md` TRACK, label `F119-sNN <slug> · F119`, task: "Implement F119 stage NN. Read spec/features/active/F119-e7-t7-identity-b-oidc/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: plan.md § Proof (/tmp/f119-sNN). List as proven only what a saved log shows."
3. Stop after stage 01 for G1. Review per § Review; run the land check of `spec/build.md`, then `limen land <id> --yes --keep-open`; drop the job DB.

## Planning progress

Stages 01–15 `[written]`; `wc -w` plan ≤1,500, stages 700, 677, 678, 692, 617, 600, 700, 691, 675, 689, 691, 544, 681, 389, 514.

## Cold review

Model `claude-opus-5-5` (`[risky]` auth and migration stages). Review 1: FAIL, 2 blocking, 16 notes ([plan-review-1.md](plan-review-1.md)); 15 fixed, N10 accepted ([plan-review-1-response.md](plan-review-1-response.md)).

## Log

- 2026-11-14: planned at 69473f4e; cold review 1 applied.
