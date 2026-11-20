# F136 notes — map for the planner

## Seams (checked 2026-11-19)

- Fixed ports are constants: `apps/web/e2e/env.ts` (`E2E_PORT = 8081`, `E2E_TELEGRAM_PORT = 8092`), `apps/docs/e2e/site.ts` (`DOCS_TEST_PORT = 8093`). Both `playwright.config.ts` files set `reuseExistingServer: false`, so a second run fails on the busy port.
- A per-job e2e database already works: web stage proofs make their own (`f102_sNN_e2e`, F102 `plan.md` § Proof). `seedTargetOk` (`apps/server/src/scripts/e2e-seed-args.ts`) accepts any name that ends in `_e2e`. `scripts/limen-prepare.sh` does not set `E2E_DATABASE_URL` / `E2E_MIGRATOR_DATABASE_URL`; each stage does it by hand.
- Shared GreenMail of the dev stack: `GREENMAIL` in `apps/web/e2e/env.ts` (IMAP 3143, SMTP 3025) and `seedAssistMailbox` in `apps/server/src/scripts/e2e-seed.ts`. The seed uses fixed addresses (`E2E_SEND_TEST_ADDRESS = "anna@example.com"`, `piotr@example.com`, `boss@example.net`). With `SEND_SCOPE=self`, one approved send goes to GreenMail per run.
- `workers: 1` in both Playwright configs stays: the seed is one organization and the specs change its state.
- The lock rule text: `CLAUDE.md` (Rules, shared runtime), `.agents/limen/styleguide.md`, `docs/code-patterns.md` § Docs site, and § Proof of the active plans F102, F107, F110, F116.

## Open questions

- Mail: are per-run addresses enough, or do specs read a GreenMail mailbox that another run can fill? Probe with two parallel runs.
- Memory: how many parallel Chromium plus server runs does the owner PC hold? Measure; write the limit in `CLAUDE.md` if there is one.
- Ports: env with a per-job offset, or a free port found at start? Playwright `webServer.url` needs the port before the run.
- Active plan texts that hold the lock: refresh them in the same land, or let the coordinator update running stages?
- Overlap: the test audit (F125 stage 06) reads `apps/web/e2e` statically; check the board at plan time.
