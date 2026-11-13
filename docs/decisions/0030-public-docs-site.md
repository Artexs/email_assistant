# 0030 — Public docs site: a static Starlight site on GitHub Pages, synthetic content only

- Status: proposed (E10 discovery, 2026-11-13). The ticket that lands the docs site (E10a) sets "accepted".
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
