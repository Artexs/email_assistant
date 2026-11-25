# 0030 — Public docs site: a static Starlight site on GitHub Pages, synthetic content only

- Status: accepted (2026-11-15, E10a, F112 stage 05). Proposed 2026-11-13 (E10 discovery).
- Date: 2026-11-13

## Context

E10 must let a stranger understand the product, what it does with their mail and what it would cost, without a sale (`docs/product/stage-2/epics/E10-go-to-market-readiness.md`). The panel is reachable only on the tailnet (ADR 0017), so a stranger cannot see anything the panel serves. The repository is already public on GitHub (`Artexs/email_assistant`). There is no domain (S6 P3) and no public server.

Facts (2026-11-13, detail and sources in `docs/product/stage-2/epics/E10-discovery-notes.md` §3):
- Starlight 0.42.11 is the current Astro docs framework. It needs Astro ≥ 7.2.10. The panel uses Astro 5.13.7. The last Starlight for Astro 5 is 0.37.7 (2026-03-06).
- GitHub Pages: static only, published site ≤ 1 GB, soft limit 100 GB traffic a month, deploy by a custom Actions workflow. The terms forbid a Pages site whose main purpose is commercial transactions or a commercial SaaS. GitHub logs visitor IP addresses; Pages sets no cookies.

This is the first surface of the product that is outside the owner's server and the tailnet. It needs its own rules.

## Decision

1. **One docs site**, a new workspace app `apps/docs` (Astro Starlight, on the same Astro major as the panel). It holds the public pages (home and positioning, security and data, pricing, changelog), the user docs (tutorial, how-to, reference, explanation) and the operator docs. Search is Starlight's built-in Pagefind index (static, no third party).
2. **Hosting**: GitHub Pages of this repository, the default `github.io` project URL, no custom domain. The site is built in CI on every pull request and deployed by a workflow on each release tag (E8, PD-053), so the docs match the released version. The panel links to it ("Help").
3. **Single source**: the site reads the operator docs, `CHANGELOG.md` and the OpenAPI file in place (Astro loaders), never as copies. The sub-processor list is one typed file in `packages/core`; the S6e legal pages and the security page both render it.
4. **Public content rules** (a CI check enforces the ones code can check):
   - No real mail. Screenshots and the demo video show only the synthetic demo organization (E2b). CI makes the screenshots from a frozen demo fixture; no screenshot is added by hand.
   - No analytics, no cookies, no forms, no third-party scripts, styles or fonts. A strict Content Security Policy.
   - No person's name, mail address, machine name or tailnet name; placeholders as in `deploy/README.md`. No competitor names.
   - Every claim on the security-and-data page links to its proof (a test, an ADR or a code file at the release tag). CI fails when a linked file does not exist.
5. **Languages**: English is the source. Polish versions exist for the public pages and the user tutorial, how-to and FAQ. A Polish page names its English source and the hash of that source; CI warns on a stale translation; the release checklist blocks a release with a stale public page.

## Consequences

- Good: a stranger can read the product without the tailnet; nothing new is exposed, because the repo is public already; the docs cannot show stale UI or real mail.
- Bad: GitHub (Microsoft) sees the IP addresses of site visitors. GitHub is the host of a public site with no user data, not a sub-processor of mail data; the security page says so.
- Bad: the panel must move from Astro 5 to Astro 7 first (its own small ticket), or the workspace holds two Astro majors.
- If the product is ever sold, the Pages terms no longer fit: move the same static build to another static host. Only the deploy workflow changes.
- The docs deploy becomes a release-checklist step (E8).

## Built (E10a, F112)

- **Versions:** Starlight 0.43.1 on Astro 7.4.12, both exact, in the workspace `apps/docs` (`@ea/docs`). The panel is on the same Astro major.
- **CSP (point 4):** the build gives every page a meta CSP. Astro hashes its own scripts and styles; a post-build pass (`apps/docs/integrations/csp-finalize.ts`) hashes Starlight's inline scripts and a page check (`docsCspProblem` in `packages/core/src/web/`) fails the build on any page that breaks the policy. Two limits are accepted for a static site with no login and no form: `style-src` holds `'unsafe-inline'` (Starlight sets `style` attributes, as the panel does, ADR 0016), and a meta CSP cannot set `frame-ancestors`, so another site can frame the docs (GitHub Pages sets no headers).
- **Build checks:** `bun run docs:build` runs the CSP check, the public-content check (no mail address that is not an example, no real host or tailnet name, no external asset; an allow list names each exception with its reason) and the link check, and logs one line for each. The operator docs are read in place from `deploy/` and `docs/release-checklist.md`; their sources never change.
- **Polish pages (point 5):** `bun run docs:stale` lists Polish pages whose English source changed. `--strict` fails on a stale public page: the home page, the tutorial pages, the security page and the pricing page.
- **CI and deploy (point 2):** the CI job `docs` builds the site and runs `docs:stale` on every push and pull request. The workflow `.github/workflows/docs-deploy.yml` runs on a pushed `v*` tag and by hand. Its gate (`apps/docs/scripts/deploy-gate.ts`) lets a pushed tag deploy only when it is the newest plain `v<x.y.z>` tag; a tag such as `v1`, `vtest` or `v0.2.0-rc.1` never deploys. A manual run deploys the chosen ref, also an old tag (a rollback). The build job has read access only; the Pages permissions belong to the `deploy` job. A deploy runs every job of `ci.yml` first (the job `checks` calls it). Then the build job runs `docs:stale --strict`, makes the screenshots from the e2e seed in its own throwaway database (`docs:shots`), builds the site with `DOCS_SHOTS=on`, runs the browser check (`docs:test`) and publishes. The PNG files go into the Pages artifact, never into git. No secret and no `.env` take part.
- **First deploy:** the owner does it, after the Pages settings are changed (source "GitHub Actions"; `v*` tags allowed in the `github-pages` environment). No agent runs the workflow.

## Built (E10b, F121)

- **Publication hold:** `OWNER_REVIEW_PENDING` in `apps/docs/src/publish-gate.ts` lists the English ids of the new public pages that the owner has not read (home, security, pricing, the two reference pages). While it is not empty, a pushed tag does not deploy the docs (green skip, reason `owner_review_pending`), and a manual run deploys only with the dispatch input `publish_held_pages`. No env value lifts the hold; the owner empties the list in one commit. A unit test checks that each id is a page.
- **Claim check:** the security page renders the typed `publicClaims` (`apps/docs/src/security/claims.ts`). Each claim cites rows of `docs/legal/claims.md` and repo files. The build fails on a missing file, on a row that the ledger marks `gap` or `unverified`, and on a missing condition (`integrations/claim-check.ts`). The page does not list what no file proves.
- **Image-path check:** the build fails with `image_outside <src> in <page>` for an image source that is not a data URI, a file of the shots folder, `favicon.svg`, the hashed header logo `_astro/mark.<hash>.svg` or a file of `public/brand/` (`integrations/image-check.ts`). The shot run (`bun run docs:shots`) takes the demo seed when `DEMO_SEED_FILE` or `apps/web/e2e/demo/demo-seed.json` names an existing file, and the e2e seed otherwise (`shotSource()` in `apps/web/e2e/lib/shot-source.ts`).
- **API reference:** `docs/api/openapi.json` is the public OpenAPI file, written by `bun run api:spec` from the app built with fakes; a unit test fails on drift. The page `reference/api` renders it.
- **Demo video:** the home page (en and pl) shows `<DemoVideo>` only when `demo.mp4`, `demo.en.vtt` and `demo.pl.vtt` stand in `apps/docs/public/demo/` at build; with no file the page shows nothing. The files are assets of the GitHub release `demo-video` (a tag that is not `v*`, so an upload starts no deploy) and are never in git. The deploy build downloads them only when `DEMO_VIDEO_SHA256` is set (`apps/docs/scripts/demo-fetch.ts`, step "Download the pinned demo video", before `docs:build`), and fails when a downloaded file does not match its pin: the video and both caption files each have a sha256 pin (`DEMO_VIDEO_SHA256`, `DEMO_CAPTION_SHA256` in `apps/docs/src/demo-video.ts`), so an upload with `--clobber` changes nothing without a commit. The public-content scan also reads the `.vtt` files. `bun run demo:record` makes the three files (`apps/web/e2e/demo/`); the owner uploads them (`deploy/README.md` § Docs site). Both pins are `null` today: no video is published (owner gate G3).
- **Not built yet:** the recording from the demo-week export (a run that logs `demo_source demo`). Until then `demo:record` records only from the e2e seed, and such a video is never uploaded.

First publication: 2026-11-18, `https://artexs.github.io/email_assistant/` (first deploy with screenshots the same day). To take it down: set Pages to None.
