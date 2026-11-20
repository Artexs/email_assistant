# F129 stage 06 — Organization and web tools

Needs stage 01: `runCli`, `exitCodeOf`. Needs stage 02: `cli-pending.json` group `org`, the standard test. Needs stage 04: `scripts/lib/invite-delivery.ts`, `lib/pick-member.ts`, `lib/org-status-lines.ts`. May run next to 05 and 07–15 (`web:invite` shares `lib/pick-member.ts` with stage 09 only by import; no edit expected there).

Part of [`../plan.md`](../plan.md). Decisions: D5, D7. Recipe: `docs/cli.md` § Convert a tool.

## Tools

| Command | Risk | Needs | Notes |
| --- | --- | --- | --- |
| `org:create` | write | db | inline parser → `org-create-args.ts` |
| `org:flag` | write | db | |
| `org:member` | write | db | loads config before the parse today: parse first |
| `org:invite` | write | db, smtp | `smtp` only when the sender is on; `--print` prints the link |
| `org:plan` | write | db | |
| `org:status` | read | db | inline parser → `org-status-args.ts` |
| `org:sso` | write | db, dns | loads config before the parse today: parse first; `--remove`/`--attest --confirm <domain>` stay as they are (not danger) |
| `web:invite` | write | db, smtp | inline parser → `web-invite-args.ts` |

`outputNote` for `org:invite` and `web:invite`: "prints the setup link with `--print`" (a secret-bearing link the operator asked for; it never goes to a log).

## Step 1 — Convert the eight tools

- Follow the recipe. Keep every result and error text byte for byte; usage lines may change to the `renderHelp` form.
- `org:member` and `org:sso`: move `loadConfig` after the parse, so `--help` and a bad flag work with no env.
- `lib/invite-delivery.ts` (pending in group `org`): its `process.stdout.write` becomes `out.write`; remove it from `cli-pending.json`.
- `org:status` catches every error in `main` today: return `exitCodeOf(error)` there; a 3 prints `[org-status] unreachable: <describeError>` instead of its `failed:` line (plan rule).
- Callers to update: `deploy/README.md` (org and SSO sections, line "`org:sso` prints `txt _ea-sso…`" stays true), `docs/capabilities/tenancy-and-plans.md` (`org:member` `error not_member`, exit 1 stays 1), `docs/known-alerts.md`, `apps/web/src/i18n/texts/en-auth.ts` and `pl-auth.ts` if they quote a usage line.

## Step 2 — Unreachable DB exits 3

- **Goal:** the one shared "DB down" path is proven on one tool of this area.
- **Test** (unit lane, spawn): `org:status --org-id 00000000-0000-4000-8000-000000000001` with the test preload's config env and `DATABASE_URL=postgres://ea:x@127.0.0.1:1/ea` → exit 3 within 15 s; stderr one line starting `[org-status] unreachable:`; no stack trace (`at ` absent).
- **Guard check:** remove the `ECONNREFUSED` match from `runCliCode` → this test gets exit 1 and fails; restore. Write both runs in the final message.

## Test (args unit tests, one file per args file)

1. `org-create-args`: valid input → typed value; missing `--name` → usage; unknown flag → usage.
2. `org-status-args`: `--org-id not-a-uuid` → usage.
3. `web-invite-args`: `--org-id <uuid> --user-id <uuid> --print` → `{ print: true }`; `--user-id x` → usage.
4. Every existing args test that expected "null on bad input" still passes, or is rewritten to expect `UsageError`; list each rewritten case.
5. Integration (`org-cli.test.ts` and the others): asserts of exit 1 for bad arguments become 2; result lines unchanged.

## Out of scope

Danger tools (stage 05); any change to service functions.

## Done when

Steps 1–2 done; the eight files and the helper are out of `cli-pending.json`; the standard test passes for them; the plan.md Proof with `s06` and `&& bun run test:e2e > /tmp/f129-s06/e2e.log 2>&1` before `echo PROOF_OK` prints `PROOF_OK` (Playwright specs spawn `org-flag.ts`), under the lock rule `CLAUDE.md` states at HEAD.
