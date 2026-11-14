FAIL f957cf1af16b047b497c7c21ceffeb02703cf423

The plan has 1 blocking finding and 8 non-blocking findings. HEAD is f957cf1af16b047b497c7c21ceffeb02703cf423, the same as the candidate. I ran no DB, no .env, no VPS and no push. I put the Astro 7 probe in `.probe-f101r/` inside the worktree and deleted it after. `git status --short` is clean.

## Blocking

**B1 — Stage 04 check 7 cannot work as written. Its baseline is always empty, and no rule covers a failure of check 7. Proven by reading the repo.**
- Where:
  - `stages/stage-04-vps-deploy.md:110` takes the "before" count with `$C logs --since <T minus 10 min> --until "$T" server`.
  - That command runs after runbook step 9 (`:93`, `$C up -d --build --wait`), which recreates the server container.
  - `deploy/README.md:71` says: "a recreated container starts empty".
- Effect:
  - The baseline is 0 every time. Any routine error in the 10 minutes after the deploy (for example an IMAP timeout) gives a count that is not "the same".
  - The Rollback covers only "runbook step 9 fails, or check 1–6 fails" (`:116`). A failed check 7 has no action.
  - Stage 04 Done when (`:134`) needs checks 1–7, so the coordinator must guess.
- Fix: take the error count of the old container before runbook step 5, for example `$C logs --since 10m server | grep -c '"level":"error"'`. Then state what a failed check 7 does: roll back, or report to the owner.

## Unverified (not blocking)

- The full e2e suite on Astro 7. It needs a DB, and this job may not use one.
- The server image build (`docker build`) and the CI `ci`, `e2e` and `image` jobs.
- The VPS checks.
- The `astro check` failure with `@astrojs/astro2tsx` 0.1.3 (F6). I did not reproduce it. I proved only that 0.1.4 gives 0 errors.
- The Shiki `[WARN]` line without D3 (F9).
- The stage 01 hand check with `default-src 'none'`.

## Notes (not blocking)

**N1 — Pre-mortem answer: stage 02 changes the panel font on Linux, and no check sees it. Proven by a CSS diff.**
- The probe CSS changes from `tailwindcss v4.1.13` to `v4.3.5`. The default `--font-sans` changes:
  - Before: `ui-sans-serif, system-ui, sans-serif, …`
  - After: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, …`
- `apps/web/src` sets no own font. A grep for `font-sans`, `font-family` and `--font` in the CSS finds nothing, so every page takes the new stack.
- On macOS and Windows the font stays the same. On Linux, which the owner uses, `system-ui` gives way to Roboto, Noto Sans or Arial.
- The diff has 182 changed lines in total. Most do not change the result (`inset: 0` for `calc(var(--spacing) * 0)`, `-moz-focusring`, and similar).
- This contradicts:
  - P2 "A user sees no difference" (`plan.md:38`)
  - Out of scope "visual changes" (`ticket.md:22`)
- F4 (`plan.md:71`) normalized away exactly the `<style>` bodies and the hashed CSS files, so no stage compares the CSS. D6 (`plan.md:46`) forbids the one-line fix in `apps/web/src`.
- Decide one of these two and record it in the plan:
  - Accept the change and correct P2 and F4.
  - Allow a D6 exception that sets `--font-sans` back to the 4.1 stack in the theme CSS.
- Add a CSS diff step to stage 02 either way.

**N2 — D10 rollback needs `git revert -m 1`. Proven from `git log`.**
- `limen land` makes merge commits, for example `63ab2a1 Merge branch 'limen/…'` and `82df057`.
- Stage 02 has two commits (`stages/stage-02-astro-7.md:97` and `:119`).
- "`git revert` of the stage 02 land commit" (`plan.md:50`, `stage-04:123`) fails without `-m 1`. Write the exact command.

**N3 — Test count drift. Proven.**
- `plan.md:139` says "stage 01 tests 1–10".
- `stages/stage-01-csp-build-check.md:65` defines tests 1–13.
- The review spawn (`plan.md:210`) checks "every numbered test", so it will check against the wrong count.

**N4 — Stage 01 hardcodes 16 pages. Proven by reading.**
- Hardcoded in the stage 01 Proof (`plan.md:167`) and in `stage-01:64-65`.
- The fallback for a different count (`plan.md:176`) sits under the stage 02 block only.
- F099 stage 10 adds `apps/web/src/pages/operator.astro` (`F099…/stages/stage-10-operator-page.md:10`). If it lands first, stage 01 fails its Proof.
- Ticket acceptance `ticket.md:27` ("16 pages") then becomes false.
- Make the fallback apply to every stage and to the ticket line.

**N5 — Stage 04 rollback leaves the VPS checkout on a detached HEAD. Plausible.**
- Rollback step 1 (`stage-04:118`) is `git checkout <commit>`, which detaches HEAD.
- `deploy/README.md:250` adds "To return later: `git checkout master`". Stage 04 leaves this out, so the next deploy's `git merge --ff-only` runs on a detached HEAD.

**N6 — The Astro note will contradict itself after stage 03. Proven.**
- Stage 03 says "Do not change the other old lines" (`stage-03:58`).
- `notes/2026-11-13-astro-starlight-versions.md:5` then still says "`apps/web` pins `astro` 5.13.7", above a new section that says 7.4.12.
- Allow an edit of line 5 too.

**N7 — The ADR 0016 amendment link will go stale. Proven by the lane move.**
- The amendment links `spec/features/<lane>/F101…/plan.md` "in the lane the ticket is in when you write" (`stage-03:14`). That is `active/`.
- Stage 04 then moves the ticket to `done/2026-11/`, so the link breaks.
- Name the final path, or link the ticket ID only.

**N8 — The D4 check does not look at the sub-directives. Plausible hardening idea.**
- `cspProblem` (`stage-01:15-19`) checks only the directive that starts with `script-src ` (with a space).
- A `script-src-elem 'unsafe-inline'`, a `script-src-attr` or an `'unsafe-eval'` would pass. I did not check whether Astro's `directives` schema accepts these.

**N9 — The lock diff touches more than the review spawn names. Proven, for information.**
- Beyond Astro, Vite and Tailwind, the lock diff also:
  - removes `esbuild` 0.25.9 (only Astro 5 and Vite 6 used it; nothing in the repo imports it)
  - moves `sharp` from 0.34.3 to 0.35.5
  - moves `ci-info` from 4.3.0 to 4.5.0
- All three are in the Astro tree. The review spawn text (`plan.md:210`, "only the astro, vite and tailwind trees") should say so, so the stage 02 reviewer does not raise a false alarm.

**Stage size:** all four stages are small enough for one job each. Stage 02 is the biggest (3 steps plus the full e2e), but it fits.

## Checks I ran

**Repo state at HEAD**
- `git rev-parse HEAD` printed `f957cf1af16b047b497c7c21ceffeb02703cf423`.
- `bun install --frozen-lockfile` passed (967 packages). Local Bun 1.4.4 matches `.bun-version`. Local Node is 26.13.1.
- `bun run web:build` on Astro 5 exited 0 and logged `style-src relaxed in 16 page(s)` (log: `/tmp/f101rev-web.log`).
- The build has 16 `.html` files, each with exactly 1 CSP meta.
- A copy of the planned `cspProblem` (`/tmp/f101r-scripts/check.ts`) returned `null` on all 16 pages.

**npm (`npm view`)**
- `astro` latest is 7.4.12: `engines.node >=22.23.4`, `vite ^8.3.6`, `zod ^4.6.7`.
- `@astrojs/react` 7.1.9 has `oxc-transform-react` as a peer.
- `@tailwindcss/vite` 4.3.5 has peer `vite ^5.2.0 || ^6 || ^7 || ^8`.
- `@astrojs/starlight` 0.43.1 has peer `astro ^7.2.10`.
- The newest `@astrojs/astro2tsx` is 0.1.4. The newest `@astrojs/check` is 0.9.12.
- These match F1 and D12.

**Probe: `git archive HEAD` copy with D1, D2 and D3 applied**
- `bun install`, then `bun update @astrojs/astro2tsx` (0.1.3 → 0.1.4): only `bun.lock` changed, with +316 −472 lines. This matches F6 and F8.
- `bun install --frozen-lockfile` reported no changes.
- The lock holds `astro@7.4.12`, `@astrojs/react@7.1.9`, `@astrojs/astro2tsx@0.1.4`, `vite@8.3.8`, `tailwindcss@4.3.5` and `@tailwindcss/vite@4.3.5`. `grep -c '\["astro@'` printed 1.
- `node_modules/astro` sits at the repo root (the `configVersion 0` linker hoists it), so the stage 04 check 1 path is correct.
- `bun run web:build` exited 0, logged `style-src relaxed in 16 page(s)`, and had no `[WARN]` line (log: `/tmp/f101r-web7.log`).
- All 16 pages: `cspProblem` returned `null`, with 7 `sha256` hashes each. The CSP meta comes before the first `<script>` and `<style>`, as on Astro 5.
- `bun --bun run --cwd apps/web build` exited 0 (log: `/tmp/f101r-bunbun.log`, F10).
- `astro check`: "Result (143 files): 0 errors" (F6).
- In the Astro 7 source: the `security.csp` schema is in `dist/core/config/schemas/base.js:255-276`. The "Invalid or outdated experimental feature" text is in `dist/core/config/validate.js:12`. `bin/astro.mjs:31` requires `>=22.23.4`. `am-i-vibing` and the agent background mode are in `dist/cli/dev/index.js`. These match F2, F10 and F11.
- The CSS diff of the two builds gave N1. The normalized CSS files are `/tmp/f101r-a.css` and `/tmp/f101r-b.css`.

**Other reads**
- The Stage 02 test 9 command printed `ci e2e image` on Bun 1.4.4.
- The stage 04 event names are real:
  - `server_listening`: `apps/server/src/main.ts:249`
  - `web_dist_missing`: `apps/server/src/platform/http.ts:369`
  - `web is on` / `web is off`: `apps/server/src/web.ts:357` and `:293`
- The `/settings` → `/login?next=…` redirect is in `apps/server/src/platform/http.ts:379`.
- The e2e DB name `f101_s02_e2e` gives `email_assistant_f101_s02_e2e` (`db-worktree-args.ts:33-39`), which passes `isE2eDatabaseName`.
- `limen ticket done FNNN` exists. `limen land` makes merge commits.
- No e2e spec has a `test.skip` or `test.fixme`.

## Note check

- **Findings quote file and line, checked against the repo at f957cf1:** proven. Evidence: `spec/features/planned/F101-panel-to-astro-7/stages/stage-04-vps-deploy.md`, `deploy/README.md`, `spec/features/planned/F101-panel-to-astro-7/plan.md`, `notes/2026-11-13-astro-starlight-versions.md`. Each finding above names its path and line.
- **Facts checked against npm and an Astro 7 probe:** not proven by the strict rule.
  - Saved logs exist: `/tmp/f101rev-web.log`, `/tmp/f101r-web7.log`, `/tmp/f101r-bunbun.log`, `/tmp/f101r-a.css`, `/tmp/f101r-b.css`.
  - The `npm view` output, the lock-diff output and the `astro check` output came from calls with `;` or pipes, and I did not save them to a file.
- **Final message format (first line `FAIL <sha>`, counts, list):** proven. Evidence: this message. 1 blocking and 8 non-blocking findings, listed above.
- **Easy-to-miss rule "no DB, no .env, no VPS, no push":** followed.
  - I ran no `db:*`, `ssh`, `docker` or `git push` command, and I read no `.env`.
  - After I deleted the probe, `git status --short` printed nothing. The command was in a call joined with `;`, so a saved file does not show this.
