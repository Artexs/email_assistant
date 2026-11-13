# E10 discovery notes (2026-11-13)

Detail for `E10-go-to-market-readiness.md` § Discovery. Session: Opus 5.5, queue row 9 of `05-execution-plan.md` §3. ADR draft: `docs/decisions/0030-public-docs-site.md` (proposed).

## 1. What was read

- Stage 2: `03-product-frame.md`, `04-review-result.md` §3, §8, §9, `05-execution-plan.md`, `decisions.md` (PD-001–PD-069), `02-inventory-and-roadmap.md` §9.3, §12, §13, all epic pages and the E2, E3, E4, E7, E8 discovery notes.
- ADRs 0012, 0013, 0015 (LLM data terms), 0017 (tailnet-only panel), 0027 (flags), 0029 (Sent read, E5 session, appeared during this session).
- `tasks/planned/s6e-papers-cost.md` (legal pages, sub-processor list D27, cost model).
- Code: `apps/web/` (Astro 5.13.7 static build, `astro.config.mjs` with the experimental CSP, `src/pages/`, `src/i18n/en.ts`), `apps/web/e2e/` (real server, seeded DB, fake Telegram on port 8092), `tools/fake-telegram/` (no viewer UI), `.github/workflows/ci.yml`, `package.json` (`triage:cost`, `web:build`, `test:e2e`), `deploy/README.md` (469 lines), `README.md` (67 lines).
- `gh repo view`: the repository is **public** (`Artexs/email_assistant`).
- grep of `notes/`, `spec/features/`, `docs/known-alerts.md` for docs site, Starlight, changelog, demo video: no earlier work. E10 absorbs no planned ticket.

## 2. Code cross-check (item · exists today · new)

| In-scope item | Exists today | New |
| --- | --- | --- |
| Positioning page | Thesis text in `03` §2 only; `README.md` is developer-facing | Home page of the docs site, en and pl |
| Security-and-data page | Facts spread over ADR 0012, 0013, 0015, 0017, `docs/product-brief.md` (Privacy row), `docs/architecture.md` §7 (retention); legal page stubs and `TERMS_VERSION` come from F082 (not on `master` yet) | Claims table with proof links; one typed sub-processor file in `packages/core` shared with S6e |
| Pricing page | Plan state (`org:plan`); `bun run triage:cost`; `docs/cost-model.md` does not exist (S6e writes it, E3a feeds M7) | One placeholder plan, a "cost to run" table read from the cost model data block |
| User docs (tutorial, how-to, reference, explanation, FAQ) | None. The panel has an onboarding page (`OnboardingPage.tsx`) and UI strings in `en.ts` | All of it; the tutorial follows the onboarding page and the E4 trust ladder |
| Operator docs | `deploy/README.md` (install, update, roll back, backup), `docs/known-alerts.md` (agent-facing alert log), `deploy/backup.sh`, `deploy/restore-test.sh` | E8 writes the runbooks; the site reads them in place |
| Docs site | None. Panel: Astro 5.13.7, static output, strict CSP; CI builds the web app and runs e2e | `apps/docs` (Starlight), CI build, Pages deploy on a release tag |
| API reference | None (E4 adds OpenAPI, ADR 0023) | Rendered from the E4 OpenAPI file |
| Public changelog | None; version `0.0.1`, no tags (E8 adds `CHANGELOG.md`, PD-053) | A site page that renders `CHANGELOG.md` |
| "What is new" in the panel | None | A dismissible card; user-facing lines in en and pl |
| Demo video | None. Pieces: e2e seed script, fake Telegram (no viewer), E2b demo organization (planned, PD-027), E4-B report page (planned) | Scripted Playwright recording + ffmpeg; a read-only chat viewer in the fake Telegram |
| Screenshots | None | Generated in CI from a frozen demo fixture |
| Static status page | None | Dropped (decision 14) |
| Capability map as the reference | `docs/capabilities/` does not exist yet (E1) | Not on the site: it is agent-facing (code entry points). The site gets a user reference instead |

Corrections to the epic page:
- "The capability map (E1) is the reference part": wrong audience. Capability pages hold code entry points for agents. The user reference is a separate set (categories, Telegram commands, settings, the API from OpenAPI).
- "Where it is served (tailnet only …)": a tailnet-only site cannot reach a stranger, so the outcome needs a public site.
- "Astro Starlight fits the existing stack": only after the panel moves to Astro 7 (§3 fact 1).

## 3. Research facts (with sources)

| # | Fact | Source, date | Decides |
| --- | --- | --- | --- |
| 1 | `@astrojs/starlight` 0.42.11 (2026-11-12) needs `astro ^7.2.10`. Starlight 0.38–0.39 need Astro 6, 0.41 needs Astro 7.0.2, 0.34–0.37 need Astro `^5.5.0`; the last of these, 0.37.7, is from 2026-03-06. Astro 7.0.0 came out 2026-06-22; the current Astro is 7.4.11. The panel pins Astro 5.13.7 (latest 5.x: 5.18.2, 2026-05-26) | `npm view` in this session (2026-11-13); https://www.npmjs.com/package/@astrojs/starlight ; Starlight 0.42 release post https://astro.build/blog/starlight-042/ (2026-09-02) | Decision 3: the panel moves to Astro 7 before the docs app |
| 2 | Starlight i18n: `defaultLocale` gives fallback content when a translation is missing; Starlight shows the default-language page in its place (maintainer: intended behaviour) | https://starlight.astro.build/guides/i18n/ ; withastro/starlight discussion #3960 (2026-06-17) | Decision 6: Polish only for a defined page set; the rest falls back to English |
| 3 | Starlight's `docsLoader()` reads only `src/content/docs`; a site can use Astro's `glob` loader with another `base` and `docsSchema` instead | withastro/starlight discussion #1257; an example commit (claudelint, `glob({ base: '../docs' })`) | Decision 2 and ADR 0030 point 3: read operator docs in place, no copies |
| 4 | Lunaria (translation tracker used by the Astro docs) is "in public beta, breaking changes" (v0.2, 2026-09-19) | https://github.com/lunariajs/lunaria ; https://lunaria.dev/blog/ | Decision 6: a 40-line in-house stale check instead |
| 5 | GitHub Pages: published site ≤ 1 GB, soft 100 GB traffic a month, 10-minute deploy limit; "not intended for or allowed to be used as a free web-hosting service to run your online business … or providing commercial software as a service (SaaS)"; no cookies; visitor IPs logged by GitHub | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits (read 2026-11-13); The Proof Desk review (2026-11-05, secondary); flowconsent.com (secondary) | Decision 4: fine for a product that is not sold; move hosts if it is ever sold |
| 6 | OpenAI EU processing: a project with Europe residency, or (since 2026-08) a per-request `eu.api.openai.com` base URL, but only for eligible organizations with approved Zero Data Retention or Modified Abuse Monitoring and a signed Modified Retention amendment; not self-serve (sales). +10% price for models released from 2026-03-05 | https://openai.com/index/introducing-data-residency-in-europe/ (2025-02-05); aiprogrammingmanual.com per-request article (2026-08-24, secondary); sovergate.com (2026-10-26, secondary, vendor blog); E3 notes (OpenAI pricing page, read 2026-11-13) | Decision 10: "in the EU" is not true today and is not a config switch |
| 7 | OpenAI API default: no training on API data, abuse logs up to 30 days; the project sends `store: false` | ADR 0015 (OpenAI terms checked 2026-11-06); https://developers.openai.com/api/docs/guides/your-data | Security page "training" and "who holds a copy" rows |
| 8 | Inbox Zero's "Security, Permissions, and AI" page covers permissions, confirmations, sensitive-data redaction, AI limits, recovery, deletion; its sub-processor list is a separate page; it does not name the AI provider on the docs page (marketing and docs, 2026) | https://docs.getinboxzero.com/essentials/security-and-data ; https://www.getinboxzero.com/subprocessors | The market page is vague; a claims table with proofs is a clear difference |
| 9 | Fyxer's trust center opens with a checklist ("Fyxer never sends emails …"), a sub-processor list, a "no training on customer data" statement with an opt-out (vendor text, marketing) | https://trust.fyxer.ai/ ; https://support.fyxer.com/article/ai-training-and-your-data-our-commitment | Security page starts with a short checklist, then the claims table |
| 10 | Buyers of EU mail tools ask: who holds a copy, is it used for training, where is the processor | `04-review-result.md` §3 (commandmail.app, privacyfence.eu, email.eu, 2026) | Security page section order |
| 11 | Playwright records video per browser context (`recordVideo`); a scripted demo with ffmpeg trim and encode stays identical across UI changes, a hand recording drifts | https://playwright.dev/docs/videos ; flaviocopes.com "Record a product demo with Playwright" (2026-07-25) | Decision 12 |

## 4. Design input for planning

### 4.1 Site map (en; pl marks the Polish set)

- `/` Home and positioning (pl): the thesis in one sentence, the three jobs, who it is for, what is different (any IMAP host, Polish and English, runs on your server, delegation chaser, never sends without a tap), the 2-minute video, links.
- `/security/` Security and data (pl): checklist, claims table, sub-processors, "what this product does not promise".
- `/pricing/` Pricing (pl): one placeholder plan, "not for sale" banner, cost-to-run table.
- `/changelog/` from `CHANGELOG.md` (en only).
- `/start/` Tutorial (pl): connect a mailbox, the shadow days, the "what I would have done" report, turn on recommended, the first urgent notice, the first delegation.
- `/how-to/…` (pl): approve or edit a draft, delegate and chase, Undo, set what is urgent for me, quiet hours, digest by mail, pause, delete or export my data.
- `/reference/…` (en): categories and their meaning, Telegram commands, settings, autonomy evidence (ADR 0028 numbers), API (from OpenAPI).
- `/explanation/…` (en; pl for "how decisions are made"): how a mail is triaged (rules before AI), why it never sends alone, how autonomy is earned, what the metrics mean.
- `/faq/` (pl).
- `/operate/…` (en, read in place from E8 and `deploy/`): install on a clean server, update and roll back, backups and restore, alerts and runbooks, keys.

### 4.2 Security-and-data page: claims list (first draft, for E10b)

Each row: claim · proof link (file at the release tag) · condition (config that changes it).

| Claim | Proof | Condition |
| --- | --- | --- |
| The system never sends a mail without your tap on the exact text | ADR 0003; send-path tests; PD-031 edit rule | — |
| Mail is stored in your Postgres on your server | ADR 0011; `deploy/compose.yaml` | — |
| Mail text goes to the AI provider for each triage and draft; the provider does not train on it; it keeps abuse logs up to 30 days | ADR 0015; OpenAI data-controls page | `LLM_PROVIDER=openai` |
| Processing location of the AI provider: US today; EU only with an approved EU project | §3 fact 6 | Changes with F076 or an approved OpenAI EU project |
| Telegram receives sender, subject, AI summary and draft text; bot messages are not end-to-end encrypted | `docs/product-brief.md`; S6e papers | Changes with E9 content-minimal mode (F075) |
| Backups are encrypted before upload to Backblaze B2 | `deploy/backup.sh`; S6f | — |
| Logs hold ids, codes and counts, never mail text; 30 days, on the server | ADR 0024; the E8 canary test | — |
| Healthchecks.io receives timing pings only | E8 (PD-052) | — |
| Retention periods per data kind | `docs/architecture.md` §7; retention job | — |
| You can export and delete your organization; senders can ask for their data to be found and erased | S6c; PD-038 DSR | — |
| Every automatic move has a reason and an Undo | Undo tests; E4 why-line | — |
| Automatic moves are earned per category on measured evidence | ADR 0028; E2a holdout report | — |
| The panel is reachable only from your private network | ADR 0017 | Changes if the panel goes public (F056) |

"Does not promise" section: no certification or audit (SOC 2, ISO 27001), no legal review, no EU-only AI processing today, no end-to-end encryption of Telegram notices, drafts can be wrong (you approve each one).

### 4.3 Sub-processor source file

`packages/core/src/legal/subprocessors.ts` (name for the plan to confirm): rows `{ id, name, purpose, dataReceived, location, termsUrl, activeWhen }`. `activeWhen` is a config condition (for example `LLM_PROVIDER === "openai"`, Telegram channel on). The S6e legal pages (`apps/web`) and the security page (`apps/docs`) render it. A unit test checks that every LLM provider id in the registry (`apps/server/src/platform/llm/providers/index.ts`) has a row.

### 4.4 Screenshots and the demo fixture

- E2b adds an export command for the demo organization at a chosen day (rows of the synthetic organization only, as a seed file in the repo). The demo data is synthetic (E2 scenario), so a public file is safe.
- A Playwright project `docs-shots` seeds the fixture into the e2e database and captures the panel pages in en and pl at fixed viewport sizes (desktop and phone). The files go into the Pages artifact, not into git.
- A CI check fails when a docs page references an image outside the generated folder or the `public/brand/` folder.

### 4.5 Demo video (2 minutes, E10b)

Script (each step about 15 s): connect a mailbox → shadow days pass (demo organization at day 3) → the "what I would have done" report → "Turn on recommended" → an urgent mail arrives, the Telegram notice (viewer) → an approval with an edit in the panel → a delegation and the chaser → Undo of an automatic move. Captions en and pl (WebVTT), no voice. `bun run demo:record` drives Playwright against the sim stack, ffmpeg trims and encodes (MP4 H.264, about 10 MB). The file is a GitHub release asset; the Pages deploy workflow downloads it into the site. The fake Telegram gets a read-only chat viewer page (bot messages and buttons from its state), labelled "test Telegram". The release checklist re-records when the shown flow changed.

### 4.6 "What is new"

`CHANGELOG.md` (Keep a Changelog, E8) holds per release a "For users" list; each line has en and pl text. The site renders the whole changelog (en). The panel card shows the "For users" lines of releases newer than the last version the user dismissed (browser storage; no migration, no API: a repeat on a new device costs nothing). The card hides when there is nothing new.

### 4.7 Stale-translation check

A Polish page has front matter `source: <en page path>` and `sourceHash: <sha256 of the en body>`. A script compares the hashes; CI prints stale pages as a warning; the release checklist fails when a page of the public set (home, security, pricing, tutorial) is stale.

### 4.8 Cold-read exit check

A fresh agent gets only the built site (no repo) and answers ten buyer questions: what does it do; who is it for; which mail hosts; who holds a copy of my mail; is it used for training; where is it processed; can it send without me; what does it cost; how do I delete my data; how do I see it work. The answers must match the claims table. Then the owner reads the site as a stranger.

## 5. Cross-epic notes (edits for the owner; not applied to other pages)

| Page | Edit |
| --- | --- |
| `05-execution-plan.md` §2 | E10 splits: E10a Docs site needs E1 and the Astro 7 ticket (wave 1–2); E10b Public pages and demo needs E2b (demo organization), E3a (M7), E7 papers and cost (S6e), E4-B (report page), E8 (changelog) (wave 3). Graph: replace `E2 → E10` with `E2b → E10b`; keep `E3 → E10`, `E7 → E10`, `E8 → E10` for E10b |
| New small ticket (wave 1) | "Panel to Astro 7": `apps/web` from Astro 5.13.7 to 7.x, the CSP integration, e2e green. Before E4-A builds new pages. Owner of the ticket: E10 (or E8 as maintenance) |
| E1 / PD-009 rule | Extend: a landed user-visible feature updates its capability page and its user doc page (en) in the same change, once E10a exists |
| E2 (E2b) | Add the demo-organization export command (seed file for docs screenshots, §4.4) |
| E4 | The OpenAPI file is public on the docs site: no internal-only routes in it (operator routes stay out or in a separate file) |
| E7 (S6e) | The sub-processor list lives in one typed file (§4.3) that the legal pages render; the security page reuses it. The papers mention GitHub only as the host of the public docs site (no user data) |
| E8 | Release checklist adds: docs build and deploy on the tag; "For users" lines in en and pl; stale public pages = 0; demo re-record when the flow changed. `CHANGELOG.md` gets the "For users" list |
| E9 | Content-minimal Telegram (F075) changes the Telegram row of the security page and the sub-processor `dataReceived` text |
| `03-product-frame.md` §2 | Job 3 text: see §6 |

## 6. Proposed text for `03-product-frame.md` §2 (decision 10)

Now: "Mail stays on the user's server and in the EU."
Proposed: "Mail is stored on the user's own server. The AI provider processes mail text without training on it. EU-only processing is a provider option, not the default."
Applied 2026-11-13 (PD-101), with a reference to ADR 0035 (E11 session draft: `OPENAI_BASE_URL` for the OpenAI EU region or an own model).
Why: the AI provider is OpenAI in the US (ADR 0015); Telegram is outside the EU; OpenAI EU processing needs sales approval (§3 fact 6); Vertex AI EU (F076) is out of Stage 2. The security page cannot claim more than this.

## 7. Tickets and size

| Ticket | Content | Stages | Source lines (code) | Needs |
| --- | --- | --- | --- | --- |
| (Astro 7, own ticket) | Panel to Astro 7, CSP integration, e2e | 3 | 200 | E1 |
| E10a Docs site | `apps/docs` Starlight, i18n en and pl, CSP and no-analytics, Pages workflow on tag; operator docs in place; user tutorial, how-to, reference, explanation, FAQ for what exists; API reference; screenshot pipeline; changelog page and "What is new" card; stale check; public-content CI check | 10 | 1,000 | Astro 7 ticket, E1 (capability map as the fact source), E8 `CHANGELOG.md` for the changelog stage |
| E10b Public pages and demo | Home and positioning, security-and-data page with proof-link check and the sub-processor file, pricing page, Polish versions, demo video and the fake Telegram viewer, cold-read check and fixes | 8 | 600 | E2b, E3a, E7 papers, E4-B, E8 |

Total E10: about 18 stages, about 1.6k source lines plus about 6k lines of Markdown (en and pl). The page said 12 stages and 2k lines; the difference is the screenshot pipeline, the proof-link and stale checks, the Polish set, and the video tooling.
