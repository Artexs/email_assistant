FAIL eb3b2c28399e732ffa03d191cd4902c9b1f577bd

HEAD matches the candidate (`git rev-parse HEAD` = eb3b2c28399e732ffa03d191cd4902c9b1f577bd, saved to `/tmp/f112-plan-review/head.txt`). The tree is clean. This review covers the plan only. I built nothing and ran no test suite.

## Blocking findings

**B1. The truth rule (P2) works per page, but the flagged behaviour sits inside unflagged pages.** (proven by reading the files)
- `plan.md:19` (P2): "A feature behind a default-off flag … gets no user page". `plan.md:73`: a page states a fact "when a capability page or the code at HEAD shows it".
- The capability pages describe flagged parts inside unflagged features:
  - `docs/capabilities/digest-and-notices.md:14`: the digest footer lines of `llm_pause_line` and `handled_share`.
  - `digest-and-notices.md:28`: the "⚠️ This was a mistake" button of `mistake_capture`.
  - `digest-and-notices.md:57`: the answered-check block of `answered_check`.
  - `drafts-and-send.md:118-122`: the reject reasons of `mistake_capture`.
- Stage 08 checks the flag per page only (`stage-08-how-to.md:11`). Stage 09 removes only the flagged commands (`stage-09-reference-explanation.md:18,20`).
- These pages will copy the flagged buttons and lines, and nothing stops them:
  - `how-to/approve-a-send`
  - `reference/telegram` ("the buttons of the digest and the notices", `stage-09:13`)
  - `how-to/correct-a-category`
  - the FAQ
- Result: a user reads about a button or a digest line that they never see.
- Fix needed:
  - A rule per sentence: no button, line, field or route that a default-off flag gates.
  - Extend `reference.test.ts` T1 to cover buttons, or give a deny list of flagged strings.

**B2. The plan sends the Polish writer to a constant that does not exist in the code, and that constant gives the wrong answer.** (proven by grep)
- `stage-08-how-to.md:21` and `stage-10-polish.md:15` tell the worker to check `POLISH_MESSAGES_ON` and to "quote the English button and message texts" when every member gets English.
- `grep -rn POLISH_MESSAGES apps packages` finds nothing. The name exists only in a stale sentence in `docs/capabilities/digest-and-notices.md:54` ("while `POLISH_MESSAGES_ON` is false, every member gets English").
- The same page says the opposite at `digest-and-notices.md:119` and `:51`: "Every Telegram text follows `users.locale`; null → Polish", and the buttons are "Gotowe, Wysłano and 'To był błąd'".
- A worker who follows stage 10 writes Polish pages that quote English Telegram texts. The users see Polish texts.
- Fix needed:
  - Remove the `POLISH_MESSAGES_ON` branch from stages 08 and 10.
  - Add a precedence rule to `plan.md:73`: when a capability page and the code disagree, the code wins, and the conflict is a question.

**B3. The rule for a manual deploy conflicts with the gate, so a rollback to an older tag is skipped.** (proven by reading the files and the GitHub workflow semantics)
- P7 (`plan.md:24`) and Q4 (`questions.md:8`) say "a manual run deploys a chosen ref".
- `stage-05-ci-deploy.md:23` says "A manual run always deploys". But `deployDecision` gets only `github.ref_type` and `github.ref_name`, and has no event input.
- A `workflow_dispatch` on a tag has `ref_type = tag`, so the gate skips any tag that is not the newest.
- The rollback in `stage-14-publication.md:31` ("a new run on a fixed commit") is to run the previous good tag by hand. That run is skipped, and the bad release stays live. Also, the GitHub UI cannot pick a commit, only a branch or a tag.
- T6 (`stage-05:31`) tests only a branch.
- Fix needed:
  - Add `event: "push" | "workflow_dispatch"` to the `deployDecision` signature.
  - Add a test: a manual run on an old tag deploys.
  - Write the rollback step as "run the workflow on tag `vX`".

**B4. Stage 11 changes the English bodies, but no step re-stamps the Polish pages.** (proven by reading the files)
- `bodyHash` covers the whole body (`stage-04-front-matter-stale.md:23`).
- Stage 11 Step 3 adds `<Shot>` to the English pages of stages 07 and 08 and to the Polish pages of stage 10 (`stage-11-screenshots.md:37`). Every Polish source hash goes stale, `pl/start` included.
- Stage 11 has no re-stamp step, and its Proof (`stage-11:47`) does not run `docs:stale`. Non-strict `docs:stale` exits 0 in CI, so nothing shows the problem.
- After stage 11, Done when 2 fails ("every Polish page of P6 exists with a current `sourceHash`", `plan.md:61`). The E8b release check `--strict` also fails (`stage-04:25`).
- The same gap is in `stage-10-polish.md:11`: "`index` (exists, re-stamp if its source changed)". Stage 07 changes the English landing page (`stage-07:19`). A re-stamp without a new translation hides a real stale page, which is what decision 6 forbids.
- Fix needed:
  - Stage 11: re-stamp each Polish page that it edits in the same way, and add `docs:stale --strict` to its Proof.
  - Stage 10: "translate the change, then re-stamp".

## Not run

- No suite ran: no `bun install`, no lint, no typecheck, no tests, no `docs:build`. This is a plan review, and `apps/docs` does not exist at this commit.
- I did not check whether the GitHub repo is public (that needs a network call). See N3.

## Notes (non-blocking)

**N1 (plausible). "An unknown key fails typecheck" (D8) probably does not hold for MDX.**
- `plan.md:37` and `stage-04-front-matter-stale.md:39,43` (T10) rely on `astro check`. As far as I know, `astro check` checks `.astro` and `.ts` files, not `.mdx` content. A T10 run in an `.astro` file proves nothing for the MDX pages.
- The lookup throws only on `{var}` keys. So when a panel key is renamed, an MDX page shows an empty `<span class="ui-label">`.
- Fix: the lookup must also throw on an unknown key (`ui_text_unknown <k>`) at build time.

**N2 (proven). The R4 rule conflicts with the list of scanned files.**
- `stage-02-csp-public-check.md:37` scans only `.html`, `.xml`, `.txt` and `.json`. But R4 (`:41`) names CSS `url(`, and R6 (`:43`) names `document.cookie` and analytics names, which live in `_astro/*.css` and `*.js`.
- F5 (`probes/facts.md:9`) checked `_astro/` once, by hand.
- The CSP and the browser check partly cover the gap. Add `.css`, `.js`, `.svg` and `.webmanifest` outside `pagefind/`, or say why they are out.

**N3 (unverified). The plan does not show that the repo is public.**
- `rewriteLinks` sends every repo link to `github.com/Artexs/email_assistant/blob/...` (`stage-03-in-place-links.md:14`). The probe facts do not say that the repo is public.
- If it is private, every rewritten link is broken for a stranger, and the link check does not fetch external URLs.
- GitHub Pages from a private repo also needs a paid plan. Record the visibility as a fact, or make it an owner step in O1.

**N4 (proven). The F8 fact misses an address that R3 rejects.**
- `deploy/README.md:148` holds `100.100.100.100` (Tailscale's DNS address, inside `100.64.0.0/10`), so R3 fails on it.
- `deploy/README.md:263` holds `0.0.0.0`, and R3 (`stage-02:40`) does not classify it.
- F8 (`probes/facts.md:12`) names neither. Stage 03 says to add allow entries "that name F8" and says "a real problem in it is a question" (`stage-03:24,37`). The worker can stop at this point.
- Fix: name both addresses in F8 and decide the class of `0.0.0.0`.

**N5 (proven). The CSP pass hashes every inline script, so `script_hash_missing` can never fail on the docs.**
- `plan.md:32` and `stage-02:25` hash every inline script before the check runs. On the docs, the new problem guards only the panel.
- A raw `<script>` in `deploy/README.md` or in an MDX page is hashed and runs.
- `cspProblem` also does not check `object-src`, `base-uri`, `form-action` or `connect-src`, so a config change that drops them passes.
- The ticket claims "CI proves that each page keeps a strict CSP" (`ticket.md:9`). That claim needs either:
  - a rule that no `<script` or `on*=` comes from content sources, or
  - an expected count of inline scripts per page, plus checks for the docs-only directives.

**N6 (proven). The F114 interface lives only in F112 files.**
- F114 must create tags as `v<x.y.z>` that match the `## [x.y.z]` headings, and its release checklist must run `docs:stale --strict` (`stage-04:25`). No "edit for the coordinator" carries this to F114 (Q2 does it for F121).
- The F114 ticket has no plan yet. Its epic, `E08-operations.md:112`, says only "git tag + CHANGELOG.md".
- Other open points:
  - No decision on SemVer pre-release tags or headings (`v0.2.0-rc.1`) in the gate (`stage-05:23`), in `compareSemver` (`stage-12:20`) or in the card.
  - No check that a deployed tag has a matching `CHANGELOG.md` release.
  - The parser behaviour on Keep a Changelog link reference lines at the file end is not stated.
  - Example headings inside the format comment at the top (`stage-12:11`) can trip the parser.

**N7 (proven). Stage 13 T15 cannot run as written.**
- `stage-13-panel-card.md:47` asks for "with a released version, the card shows it" in e2e.
- But the build reads the real `CHANGELOG.md`, which holds only `Unreleased` (`:44`). No build input to give a fixture changelog is defined.
- The worker must invent one (an env or a path), and that input then also exists in the production build. Remove the second half of T15 (T12 covers the card), or define the input.

**N8 (proven). P9 has gaps.**
- `stage-13:13` adds "at most 5 releases" and "drops releases with no For users items". P9 (`plan.md:26`) does not say either.
- The storage key `ea.whatsNewSeen` is the same for each member and organization in one browser (`stage-13:14`). A second member in the same browser never sees the card. Decide this or accept it.

**N9 (plausible). The deploy permissions are wider than needed.**
- `pages: write` and `id-token: write` are set at workflow level (`stage-05:21`).
- After stage 11, the `build` job also runs the full app stack, the seed and Playwright (`stage-11:38`). Give these permissions only to the `deploy` job.
- Two more effects:
  - `concurrency` with `cancel-in-progress: false` still cancels an older *pending* run.
  - Stage 06's browser check and `docs:stale --strict` do not run in the deploy, so a tag deploy is gated only by `docs:build`.

**N10 (plausible). Stage 11 shares a function across app borders.**
- `stage-11:27` uses "a shared function" from stage 02. But stage 02 puts the rules in `apps/docs/integrations/public-content.ts` (`stage-02:36`).
- `apps/web/e2e` would then import from `apps/docs`. Decide where R1–R3 live (for example `@ea/core/web`).

**N11. Stages 11 and 13 are large for one Sonnet job.** Size only, no break found.
- Stage 11: a component with a build flag, a Playwright shot run on its own e2e DB, a deploy YAML with services, and edits to the en and pl pages.
- Stage 13: a flag, a pure function, panel UI with i18n, a Dockerfile change and e2e.
- Both are under 700 words, but each holds three different kinds of work. Consider a split: shots on the pages vs. shots in the deploy, and logic vs. UI+e2e.

**N12 (proven). Starlight fallback pages are not in the plan.**
- F7 (`probes/facts.md:11`) shows that Starlight builds `/pl/...` pages from the English source for every page, the operator page and the changelog included.
- The stage 02/03 page counts, stage 06 T1/T4 and the `site-map.test.ts` "extra page" rule (`stage-07:13`) do not say how these pages count. A worker will guess.

**N13 (unverified). The Expressive Code markup can split tokens.**
- Code blocks can split a host or an address across `<span>` tags, so a regex on raw HTML (R1–R3) can miss it.
- The `data-code` copy attribute probably holds the raw text, so the risk is low. Scanning the text with the tags removed as well would close it.

**N14 (proven). Small things.**
- The image job installs all dependencies (`deploy/Dockerfile:10`, "Dev dependencies stay"). So after stages 01 and 06, the server image gets the Starlight, Playwright and axe trees. Stage 01 allows a `--filter` fallback, but stage 06 has no image re-check.
- The board facts are true:
  - F101 is in `active/`, which matches "Build after: F101 in done/".
  - The panel pins `astro` 7.4.12 and `@playwright/test` 1.65.0.
  - `ci.yml` has jobs `ci`, `e2e` and `image`, and `permissions: contents: read`.
  - `categories` has 7 entries.
  - `@ea/core/web` exists as an export.

## Commands I ran (all read-only)

- `mkdir -p /tmp/f112-plan-review && git rev-parse HEAD > /tmp/f112-plan-review/head.txt && grep -qx eb3b2c28399e732ffa03d191cd4902c9b1f577bd /tmp/f112-plan-review/head.txt && echo HEAD_OK`: printed `HEAD_OK`. `git status --short`: clean.
- I read `ticket.md`, `plan.md`, `questions.md`, `probes/*` and all 14 stage files.
- `wc -w`: `plan.md` and all 14 stage files are inside the § Plan size limits. The counts match `plan.md:128`.
- `grep` on `packages/core/src/features.ts`: 12 flags, all default off.
- `grep` on `docs/capabilities/*.md` for flags and `POLISH_MESSAGES_ON`: the results are cited in B1 and B2.
- `grep -rn POLISH_MESSAGES apps packages`: no hit.
- I read `apps/web/integrations/csp-style-src.ts`: the `cspProblem` list, which has no `object-src`, `base-uri` or `form-action` checks.
- I read `deploy/Dockerfile` and grepped `ci.yml` for triggers, jobs and permissions.
- `grep` on `deploy/README.md` for IPs, `ts.net`, mail addresses and relative links: `100.100.100.100:148`, `0.0.0.0:263`.
- I read the F114 ticket, and grepped E08 and E10 for changelog, tag and SemVer.
- I read the `apps/web` package and Playwright config: `@playwright/test` 1.65.0, `astro` 7.4.12, `testDir ./tests`.

## Note check

- HEAD equals eb3b2c28399e732ffa03d191cd4902c9b1f577bd: proven. `mkdir -p /tmp/f112-plan-review && git rev-parse HEAD > /tmp/f112-plan-review/head.txt && grep -qx eb3b2c28399e732ffa03d191cd4902c9b1f577bd /tmp/f112-plan-review/head.txt && echo HEAD_OK` printed HEAD_OK; file `/tmp/f112-plan-review/head.txt`.
- Each focus area is checked, and each finding quotes file:line: proven. `/tmp/f112-plan-review/review.md` maps the areas to findings: stage 02 → N2, N4, N5, N13; stage 05 → B3, N9; stages 01/06 → N14; P2/stage 10 → B1, B2, B4; stage 12 → N6; P9/stage 13 → N7, N8.
- First line `PASS|FAIL <sha>`, ending with the verdict and counts: proven. `/tmp/f112-plan-review/review.md` and this message.
- Easy-to-miss rule (code detail is not a finding): followed. Each of B1–B4 and N1–N14 names a missing decision, a rule conflict, a test or an interface. None asks only for line numbers, edit text or file lists. Copy in `/tmp/f112-plan-review/review.md`.

## Verdict

FAIL: 4 blocking findings (B1–B4) and 14 non-blocking notes (N1–N14).
