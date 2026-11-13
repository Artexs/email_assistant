# E10 · Go-to-market readiness without sales

> Tier: Should. Status: ready to plan (discovery 2026-11-13, PD-096–PD-103; plan E10a after E1 and the Astro 7 ticket, E10b after E2b, E3a, E7 papers, E4-B and E8). Size (corrected): about 18 stages, 1.6k source lines plus about 6k lines of Markdown (en and pl), two tickets: E10a Docs site, E10b Public pages and demo.

## Outcome

A stranger can understand what the product is, what it does with their mail, what it would cost, and see it work, without any sale taking place. The user and operator docs exist.

## Users

A prospective buyer or auditor; a new user; the operator.

## In scope

- Positioning page from `03` §2 (one paragraph, the three jobs, what is different).
- Security-and-data page (04 §3): who holds a copy of the mail, is it used for training, where is it processed, which sub-processors (LLM provider, Telegram, Backblaze, Tailscale), retention, delete and export, the "never auto-send" rule.
- Pricing page with a placeholder price derived from M7 and the cost model (E3, E7).
- User docs: manual, FAQ, onboarding guide (Diátaxis: tutorial, how-to, reference, explanation); operator docs: runbooks, deploy, alerts (E8). Docs site built from the repo. The capability map (E1) is the reference part.
- Public changelog; "What is new" in the panel.
- A two-minute demo video from the demo organization (E2) and the "what I would have done" report (E4).
- Static status page (optional).

## Out of scope

Real pricing, payment, a company, marketing campaigns, SEO work.

## Dependencies

E2a (numbers for the pages), E2b (demo organization in the sim stack with its reset command, PD-027), E3 (numbers), E7 (papers, cost model). E8 for operator docs.

From E8 discovery (2026-11-13, PD-051–PD-055): the operator docs (runbooks per alert, release and rollback, restore drill with its measured time, VPS-lost runbook) come from E8. The security-and-data page states: logs hold ids, codes and counts only (a canary test proves it), stay on the server, 30 days; no hosted log or error service; Healthchecks.io receives timing pings only, no data. The public changelog builds on E8's `CHANGELOG.md` (SemVer `0.y.z`, `1.0.0` at the Stage 2 exit).

## Open product questions

1. Docs site tool (Astro Starlight fits the existing stack) and where it is served (tailnet only, or a public static site with no product behind it).
2. Language of the public pages: Polish and English, or English first.

## Risks

- Text drifts from the product: the PD-009 rule (a landed feature updates its capability page) keeps the reference part true; the marketing pages need a review per release.

## Exit

- The pages exist and the owner reads them as a stranger would; the demo video plays; the docs site builds in CI.

## Discovery (2026-11-13)

Session: Opus 5.5, queue row 9. Detail, sources, site map, claims list and design input: [`E10-discovery-notes.md`](E10-discovery-notes.md). ADR draft: `docs/decisions/0030-public-docs-site.md` (proposed).

### Verdict: modify

The outcome is right for the thesis: job 3 ("trust and privacy") needs a page a buyer can check, and a sell-ready product needs docs. Five changes:
1. **A public site, not the tailnet.** The panel is tailnet only (ADR 0017), so a stranger can see nothing it serves. The repo is already public, so a static docs site on GitHub Pages exposes nothing new. It must hold no real mail and no personal data (ADR 0030).
2. **Truth with proof.** The security-and-data page is a claims table: each claim links to the test, ADR or code file that proves it, and CI checks the links. The frame's "mail stays … in the EU" is not true today (OpenAI processes in the US; EU processing needs OpenAI sales approval), so the page and `03` §2 must say what is true.
3. **Docs that cannot go stale.** Screenshots come from CI with a frozen synthetic demo fixture; the demo video is a scripted recording; operator docs, the changelog and the API reference are read in place; a stale-translation check guards the Polish pages.
4. **Split in time.** E10a Docs site can start early (after E1 and an Astro 7 upgrade), so every later epic adds its user doc page as it lands. E10b Public pages and demo waits for the numbers and the demo (E2b, E3a, E7 papers, E4-B, E8).
5. **Cut** the static status page (no public service exists to report on). **Correct** the reference part: the capability map is agent-facing; users get their own reference.

### Code cross-check (short; full table in notes §2)

| Item | Exists today | New |
| --- | --- | --- |
| Positioning, security, pricing pages | Text in `03` §2, ADR 0012/0013/0015/0017, `docs/architecture.md` §7; `triage:cost`; plan state | All three pages; sub-processor file in `packages/core` |
| User docs | None; onboarding page and `en.ts` strings | Tutorial, how-to, reference, explanation, FAQ |
| Operator docs | `deploy/README.md`, `deploy/backup.sh`, `restore-test.sh` | E8 runbooks, read in place |
| Docs site | None; panel on Astro 5.13.7, static, strict CSP | `apps/docs` (Starlight), Pages deploy on a release tag |
| Changelog, "What is new" | None (E8 adds `CHANGELOG.md`) | Site page; panel card |
| Demo video | e2e seed, fake Telegram without a viewer; E2b demo org planned | Scripted recording; a read-only Telegram viewer |
| Status page | None | Dropped |

### Cross-epic notes (edits for the owner: notes §5)

- New small ticket "Panel to Astro 7" (wave 1, before E4-A pages): Starlight 0.42 needs Astro ≥ 7.2.10.
- E2b: an export command for the demo organization (seed file for docs screenshots).
- E4: the OpenAPI file becomes public; operator routes stay out of it.
- E7 (S6e): one typed sub-processor file renders both the legal pages and the security page.
- E8: release checklist adds the docs deploy, "For users" lines in en and pl, no stale public page, a demo re-record when the flow changed.
- E9: content-minimal Telegram changes the security page's Telegram row.
- PD-009 rule: once E10a exists, a landed user-visible feature also updates its user doc page (en).
- `05` §2 graph: `E2 → E10` becomes `E2b → E10b`; E10a needs only E1 and the Astro 7 ticket.

### Research facts that decide (sources in notes §3)

- Starlight 0.42.11 needs Astro ≥ 7.2.10; the last Starlight for Astro 5 (0.37.7) is from 2026-03 (npm, 2026-11-13).
- Starlight falls back to the default language for a missing translation; Lunaria (translation tracker) is still beta.
- GitHub Pages: ≤ 1 GB, soft 100 GB a month; its terms forbid a commercial SaaS site; no cookies; GitHub logs visitor IPs.
- OpenAI EU processing needs approved Zero Data Retention or Modified Abuse Monitoring and a signed amendment; +10% price (OpenAI, 2025-02 and 2026-08 sources).
- Competitor security pages (Inbox Zero, Fyxer; marketing) list permissions and a "never sends" checklist but give no proof per claim.

### Decisions (owner: "Go with defaults.", 2026-11-13; rows PD-096–PD-103)

1. Split into E10a Docs site (wave 1–2, after E1 and the Astro 7 ticket) and E10b Public pages and demo (wave 3). [yes]
2. Docs tool: Astro Starlight 0.42 in a new app `apps/docs`; built-in Pagefind search; no analytics. [yes]
3. Move the panel to Astro 7 in its own small ticket before E4-A builds new pages, so the workspace has one Astro. [yes]
4. Public static site on GitHub Pages of this repo, default `github.io` URL, no domain; CI builds it on every PR; deploy on each release tag; the panel links to it. ADR 0030. [yes]
5. Public content rules: synthetic demo data only (CI screenshots from a frozen fixture); no analytics, cookies, forms or third-party assets; no person, address, machine or tailnet name; no competitor names. [yes]
6. Language: English source; Polish for home, security, pricing, tutorial, how-to and FAQ; operator docs and reference in English; in-house stale check (CI warns, the release blocks on a stale public page). [yes]
7. Extend PD-009: a landed user-visible feature updates its user doc page (en) in the same change, once E10a exists. [yes]
8. Reference: user reference (categories, Telegram commands, settings, autonomy evidence) plus the API reference from the E4 OpenAPI file; the capability map stays agent-facing, off the site. [yes]
9. Security-and-data page: short checklist, then a claims table with proof links (CI checks them), sub-processors from one typed file shared with S6e, a "does not promise" section. [yes]
10. EU claim: change `03` §2 job 3 to the true text: stored on the user's own server; the AI provider processes mail text without training; EU-only processing is an endpoint option (ADR 0035 draft of the E11 session), not the default of this install. No provider change from E10. [change the text; applied 2026-11-13]
11. Pricing: one placeholder plan, $25 per mailbox per month, "not for sale" banner; a cost-to-run table read from the cost model (M7 at 50, 100, 200 mails a day); no tiers, no checkout. [yes]
12. Demo video: 2 minutes, scripted Playwright on the E2b demo organization plus ffmpeg, captions en and pl, no voice; the Telegram part from a read-only viewer in the fake Telegram; a GitHub release asset, not in git. [yes]
13. "What is new": the site renders `CHANGELOG.md`; the panel card shows the "For users" lines (en and pl) of releases since the last dismissed version; browser storage, no migration. [yes]
14. Static status page: drop. [drop]
15. Product name: a working name "Email Assistant" in one site constant; the owner can rename it any time. [working name]
16. Exit adds a cold read: a fresh agent with only the built site answers ten buyer questions; the answers match the claims table; axe WCAG 2.2 AA check on the site (as PD-035). [yes]
17. Cross-epic edits of notes §5: listed for the owner and the first planning session; this session edits no other epic page and not the `05` §2 graph. [yes]
18. Commit the changed files by explicit path. [yes]

### Size (corrected)

About 18 stages (page: 12): E10a 10, E10b 8; about 1.6k source lines plus about 6k lines of Markdown (page: 2k lines). Not counted: the Astro 7 ticket (about 3 stages). Added: screenshot pipeline, proof-link and stale checks, the Polish set, video tooling. Removed: status page.

### Risks (confirmed, added, removed)

- Text drifts from the product (kept) → PD-009 extension, read-in-place sources, CI screenshots, stale and proof-link checks, release-checklist lines.
- The public site leaks private data: real mail in a screenshot, the tailnet name, a person's address (added) → ADR 0030 rules; screenshots only from the fixture; a CI grep for `ts.net` hosts and mail addresses outside example domains.
- The pages overclaim (EU, security) (added) → claims table with proofs; decision 10.
- The Astro 7 move breaks the panel (CSP integration, islands) (added) → own ticket, e2e and the CSP check green before E10a.
- GitHub Pages terms if the product is ever sold (added) → plain static build; moving host changes only the deploy workflow.
- The demo video goes stale (added) → one record command; a release-checklist line.
- Removed: none.

### Planned tickets: absorbed, replaced, dropped

None. E10 absorbs no planned ticket (grep of `spec/features/planned/`, 2026-11-13).
