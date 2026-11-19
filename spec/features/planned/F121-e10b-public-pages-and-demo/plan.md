# F121 plan — E10b Public pages and demo

> **Status — planned.** Plan base: `f21809c4`, refreshed 2026-11-19 (first base `c68ce51e`, [plan-refresh-1.md](plan-refresh-1.md)). 12 stages and one conditional. [scouts.md](scouts.md), [questions.md](questions.md), [interfaces.md](interfaces.md).

## Input

Epic `E10-go-to-market-readiness.md` decisions 1–18 (owner: "Go with defaults."); notes `E10-discovery-notes.md` §4; ADR 0030. Owner words:
- "Public content rules: synthetic demo data only … no person, address, machine or tailnet name; no competitor names." (decision 5)
- "the user docs describe nothing that a default-off flag gates, and a test enforces it" (owner-decisions 2026-11-15, F112 Q1)
- Job rule: "any step that publishes to a third party or a public domain is an owner gate with a default (prepare, do not publish)".
- Replan 2026-11-20 (`notes/2026-11-20-replan-parallel.md` § 10): C1 gates no stage; a follow-up ticket swaps the demo seed in. The docs hold (D1) is accepted.

### Product

- **P1** Home, `/security/`, `/pricing/` in en and pl (decision 6); `/reference/api/`, `/reference/autonomy-evidence/` en only.
- **P2** Security page: checklist → claims table → sub-processors (registry) → "Hosts of this site" (GitHub) → "does not promise" (notes §4.2). EU text = PD-101. No F121 page names Gemini (F138). Rejected: a GitHub registry row (not a mail processor).
- **P3** Pricing: `$25` per mailbox per month placeholder, "not for sale" banner, cost table at 50, 100, 200 mails a day from `costToRun` with its `basis`; USD; no tiers (decision 11); no model names.
- **P4** Home: thesis, three jobs, audience, what is different, the video when published.
- **P5** Video: decision-12 script (8 steps), flags on; a line under it says some features are off by default (Q2).
- **P6** Autonomy-evidence reference: only behaviour that no default-off flag gates (Q3).
- **P7** API reference: every operation of the public OpenAPI file, grouped by tag, with an intro line that some routes answer only while an operator turns a feature on (Q4).

### Design

- **D1** Publication hold: while `OWNER_REVIEW_PENDING` (the five new page ids) is not empty, a pushed tag does not deploy the docs (green skip); a manual run deploys only with the box `publish_held_pages`. Stage 01 sets it before any page lands; G1 empties it. The hold also holds other tickets' docs changes until G1 (owner accepted, replan decision 12). Rejected: Starlight drafts (home cannot be one; links break).
- **D2** Claims: typed `publicClaims`; each cites ledger ids of `docs/legal/claims.md` and repo paths that those rows name. The build fails on a missing path, a weak row (`gap`/`unverified` anywhere in the source) or a missing condition. Rejected: hand-written links.
- **D3** Cost table renders `costToRun` at build through `roundedCostRow` (one rounding and margin rule, shared with the `docs/cost-model.md` test); a line says the rounded parts may not add up. One price constant in `site.ts`.
- **D4** OpenAPI: `bun run api:spec` writes `docs/api/openapi.json` from the app built with fakes; a unit drift test. Rejected: the server inside the docs build.
- **D5** Seed source: `shotSource()` (stage 07) picks the demo seed when `DEMO_SEED_FILE` (default `apps/web/e2e/demo/demo-seed.json`) exists, else the e2e seed. Shots (07) and recording (10) use it.
- **D6** Demo seed: one C1 export of run day 5 (shadow days 1–3, assist from day 4); outside git until G2 (`~/.local/share/email-assistant/demo/demo-seed-day5.json`, mode 0600).
- **D7** Recording runs on the e2e servers (LLM triage off) with its own `*_demo` database (C3), under the shared lock. It drives only the panel, product CLIs and GreenMail delivery, never raw SQL. A step that cannot run live shows its result from the seed state, and its caption says the day. More than two such steps = stop and ask.
- **D8** Video: `demo.mp4` (H.264, ≤ 15 MB) and two VTT, assets of the release `demo-video` (no deploy trigger), never in git. The deploy downloads them only when `DEMO_VIDEO_SHA256` is set and matches.
- **D9** No migration, no `bun.lock` change, no new package; CI never runs ffmpeg.
- **D10** Stages 09–10 do not wait for C1: they build and prove on the e2e seed. On that source a step may sign in to the e2e organization that holds its state; captions name no organization. An e2e-seed video is never a G3 candidate. A follow-up ticket (C4) records from the C1 seed and redoes the spike for it.
- **D11** Pure modules of stages 07, 09, 10 and their bun tests live in `apps/web/e2e/lib/` (added to `test:unit`); Playwright folders hold specs only (bun collects a spec and fails). DB-side setup and its integration tests live in the server (`setupDemoOrg`, `test:int`).

## Facts checked (base `f21809c4`)

- `costToRun(mailsPerDay, { mailboxesPerHost?, pilot? })` → `{ llmUsd, hostingUsd, backupUsd, totalUsd, basis }` and `pilotCost` exist (F107 stage 08, from `@ea/core`). Basis today: `estimate` (87 mails < 100). `docs/cost-model.md` holds the $25 price and the table (0.62, 0.83, 1.26 at 20 mailboxes per host); its test rounds half up.
- Registry (`@ea/core/web`): 11 rows, 10 with a placeholder; F138 stage 02 removes `gemini`; `web-push` and reply-draft data describe flag-gated features (Q11).
- `apiDoc` has `alsoOk` (two success answers).
- `docs-deploy.yml` unchanged since `c68ce51e`.
- e2e: LLM triage off, fixed ports, one organization per spec. A demo import makes a paused mailbox.

## Not verified

- Which demo-script steps run live on the e2e seed (stage 09 spike, D7, D10).
- `<video>` and `<track>` under the docs CSP (stage 11 browser check).
- Size of a day-5 seed (C1 measures; G2 needs < 5 MB).

## Rules for every stage

- Format only the stage's files. No `.env` read. No secret, person, real address, host or tailnet name anywhere.
- No page text for a default-off flag (`flagged-text.test.ts` green; extend its lists for a new flagged string).
- A pl page carries `source` and `sourceHash` (`bun run docs:stale --stamp`).
- Never push a tag, run `docs-deploy`, upload a release asset or commit a demo seed: those are G1–G3.
- Lock rule until F136 lands: `test:e2e`, `docs:shots`, `docs:test` and `demo:record` run only under `flock /tmp/email-assistant-shared-tests.lock`. F136's last stage edits the open stage files.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f121-sNN && bun run lint > /tmp/f121-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f121-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f121-sNN/unit.log 2>&1 && bun run docs:build > /tmp/f121-sNN/docs.log 2>&1 && echo PROOF_OK
```

Stages 07, 10, 11, 12 add a Playwright link (in the stage file).

## Coordinator steps and owner gates

- **C1** (VPS pre-approved; spend ≤ $5, PD-023). Start only after the F113 day run `day-20261120-215c` ends (2026-11-20 about 22:00 UTC): one sim stack, and the day run forbids restarts. Then `bun run lab demo-reset --date <earliest accepted>`; after run day 5 and a trial export, `bun run lab demo-export --day 5 --out <file>` to the D6 path; size and counts in `notes/`. No stage waits for C1 (D10).
- **C2** (after stage 12): cold-read scout with the stage 12 pack; findings → stage 13.
- **C3** (before stage 10): from the main checkout, `bun run db:worktree f121_demo`; put its two URLs into the main `.env` as `DEMO_DATABASE_URL` and `DEMO_MIGRATOR_DATABASE_URL` (prepare copies them; never in task text). Drop it (`--drop`) when the follow-up closes.
- **C4** (when this refresh lands, before stage 09): apply the `ticket.md` edit and create the follow-up ticket, both in `plan-refresh-1.md` § Edits outside the folder.
- **G1** owner: read the built site, then empty `OWNER_REVIEW_PENDING`. Default: the list stays.
- **G2** owner: commit the C1 seed at the D5 path (public repo). Default: not committed.
- **G3** owner: watch and upload the follow-up ticket's video; the coordinator pins the sha256. Default: no video.

## Review

Opus review before the land: stages 01–07, 09, 11; others land on the proof.

## Stages

Files in `stages/`: 01 publication hold and claim check `[risky]`; 02 security page (en) `[risky]`; 03 pricing page (en); 04 home (en, pl); 05 Polish security and pricing; 06 API and evidence reference; 07 shots from the demo seed `[risky]`; 08 fake Telegram viewer; 09 demo script; 10 demo record; 11 video on the site `[risky]`; 12 close-out. 13 (conditional): cold-read fixes that the coordinator writes from C2.

## How to run (coordinator)

Each Needs line names what the stage reads. Start at once: 01, 07, 08. After 01: 03, and 02 once F138 stage 02 removed the `gemini` row. 06 after 02. 04 after 02, 03. 05 after 04. 09 after 08. 10 after 07, 09, C3. 11 after 01, 04. 12 after 05, 06, 07, 10, 11.

Spawn: the standing worker route (`spec/build.md` TRACK), `--prepare 'bash scripts/limen-prepare.sh'`, task "Implement F121 stage NN from its folder; final proof: the stage's Proof after the last commit". Land with `limen land <id> --yes --keep-open`; drop the job DB.

## Planning progress

- [written] ticket, plan, interfaces, questions, scouts (4), stages 01–12; review 1 applied. Refresh 1 at `f21809c4` (no scouts). Words: plan ≤ 1,500, stages ≤ 700.

## Cold review

`claude-opus-5-5`, high (`[risky]` stages). Review 1: 3 blocking, 17 notes, all fixed ([response](plan-review-1-response.md)). Review 2 (refresh): [plan-review-2.md](plan-review-2.md), [response](plan-review-2-response.md).

