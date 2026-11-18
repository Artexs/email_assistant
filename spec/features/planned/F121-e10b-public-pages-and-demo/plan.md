# F121 plan — E10b Public pages and demo

> **Status 2026-11-19 — planned.** Plan base: `c68ce51e`. 11 stages and one conditional fix stage; nothing built. [scouts.md](scouts.md), [questions.md](questions.md), [interfaces.md](interfaces.md).

## Input

Epic `E10-go-to-market-readiness.md` § Discovery, decisions 1–18 (owner: "Go with defaults.", 2026-11-13); notes `E10-discovery-notes.md` §4; ADR 0030. F112 left here: home, security, pricing, video, cold read, API and evidence reference, shots from the E2b fixture, the strict stale set.

Owner words that bound it:
- "Public content rules: synthetic demo data only … no person, address, machine or tailnet name; no competitor names." (decision 5)
- "the user docs describe nothing that a default-off flag gates, and a test enforces it" (owner-decisions 2026-11-15, F112 Q1)
- Job rule: "any step that publishes to a third party or a public domain is an owner gate with a default (prepare, do not publish)".

### Product

- **P1** Home, `/security/`, `/pricing/` in en and pl (decision 6); `/reference/api/`, `/reference/autonomy-evidence/` en only.
- **P2** Security page: checklist → claims table → sub-processors (F107 registry) → "Hosts of this site" (GitHub) → "does not promise" (notes §4.2). EU text = PD-101. Rejected: a GitHub registry row (not a mail processor; forces a `TERMS_VERSION` bump).
- **P3** Pricing: `$25` per mailbox per month placeholder, "not for sale" banner, cost table at 50, 100, 200 mails a day from `costToRun` (F107 D10) with its `basis`; USD; no tiers (decision 11).
- **P4** Home: thesis, three jobs, audience, what is different, the video when published (notes §4.1).
- **P5** Video: decision-12 script (8 steps), demo org with its flags on; a line under it says some features are off by default. Default, owner to confirm (Q2).
- **P6** Autonomy-evidence reference: only behaviour that no default-off flag gates. Default (Q3).
- **P7** API reference: every operation of the public OpenAPI file, grouped by tag, with an intro line that some routes answer only while an operator turns a feature on. Default (Q4).

### Design

- **D1** Publication hold: `OWNER_REVIEW_PENDING` (interfaces.md) lists page ids. While it is not empty, a pushed `v*` tag does not deploy the docs (a green skip with the reason `owner_review_pending`); a manual run (the owner's own act) still deploys. Initial value `["index", "security", "pricing"]`, set in stage 01 before any content lands. Owner gate G1 empties it. Rejected: Starlight `draft` pages (links from home to a draft break the link check; home cannot be a draft).
- **D2** Claims: a typed list `publicClaims` in `apps/docs`; each row cites ids of `docs/legal/claims.md` (F107) and repo paths. Build check: every path exists; every cited id exists and its source is not `gap` or `unverified`. Links point to `REPO_URL/blob/<docsGitRef()>/<path>`. Rejected: hand-written Markdown links (no check).
- **D3** Cost table renders `costToRun` at build time; a unit test compares the rendered rows with `costToRun` (2 decimals). The price is one constant in `packages/core/src/site.ts`.
- **D4** OpenAPI: `bun run api:spec` writes `docs/api/openapi.json` from the real app built with fakes (as `openapi-routes.test.ts` does). A unit test fails when the committed file differs from a fresh build. The docs page reads the file in place. Rejected: building the server inside the docs build.
- **D5** Shots: the shot run imports the demo seed when `DEMO_SEED_FILE` (default `apps/web/e2e/demo/demo-seed.json`) exists, else it keeps the e2e seed (today). The committed file waits for G2.
- **D6** Demo seed: one export of run day 5 (shadow days 1–3, assist from day 4) by coordinator step C1; it lives outside git until G2 (`~/.local/share/email-assistant/demo/demo-seed-day5.json`, mode 0600).
- **D7** Recording runs on the e2e stack (LLM triage off) under the shared lock, with the imported seed. It drives only the panel, product CLIs and GreenMail delivery, never raw SQL. A step that cannot run live shows its result from the seed state, and its caption says the day. More than two such steps = stop and ask.
- **D8** Video files: `demo.mp4` (H.264, ≤ 15 MB), `demo.en.vtt`, `demo.pl.vtt`, assets of the GitHub release `demo-video` (a non-`v` tag, so no deploy trigger). The deploy build downloads them when present; else the home page has no video. Never in git.
- **D9** No migration, no `bun.lock` change, no new package. CI never runs ffmpeg.

## Facts checked (2026-11-19, base `c68ce51e`, read by the planner)

- Docs pages, checks, deploy gate, site constants: scout 1, `apps/docs/`.
- Registry has no GitHub row; `usedWhenText` exists; `docs/legal/claims.md` marks `gap`/`unverified`.
- `costToRun` is not built yet (F107 stage 08 interface).
- `openapi-routes.test.ts` builds the app with fakes, no DB.
- e2e: LLM triage off, web 8081, fake Telegram 8092.
- Demo import makes a paused mailbox, no Telegram link (`live-lab.md` rule 24).
- Every flag defaults to `false`, `trust_ladder` too.
- ffmpeg is local only (scout 3).

## Not verified

- Which demo-script steps run live on the e2e stack (stage 09 spike, D7).
- `<video>` and `<track>` under the docs CSP (stage 10 browser check).
- Size of a day-5 seed (C1 measures; G2 needs < 5 MB).

## Done when

1. Home, security, pricing in en and pl, in the strict stale set.
2. The build fails on a missing proof path or a weak ledger id.
3. Pricing rows equal `costToRun`.
4. The deploy gate skips a pushed tag while `OWNER_REVIEW_PENDING` is not empty.
5. `docs/api/openapi.json` matches the app; reference pages build.
6. `demo:record` makes the three files; the viewer escapes text.
7. C2 answers match the claims table; axe zero violations on new pages.

## Rules for every stage

- Format only the stage's files. No `.env` read. No secret, person, real address, host or tailnet name in a page, fixture or log.
- No page text for a default-off flag (`flagged-text.test.ts` stays green; extend its lists if a new flagged string appears).
- A pl page carries `source` and `sourceHash` (`bun run docs:stale --stamp`).
- Never push a tag, run `docs-deploy`, upload a release asset or commit a demo seed: those are G1–G3.
- `test:e2e`, `docs:shots`, `docs:test` and `demo:record` run only under `flock /tmp/email-assistant-shared-tests.lock`.
- A gap or a deviation is a question in the final message, not a choice.

## Proof

```
mkdir -p /tmp/f121-sNN && bun run lint > /tmp/f121-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f121-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f121-sNN/unit.log 2>&1 && bun run docs:build > /tmp/f121-sNN/docs.log 2>&1 && echo PROOF_OK
```

Stages 07, 09, 10, 11 add their own link to the chain (in the stage file).

## Coordinator steps and owner gates

- **C1** (start at the build start; VPS pre-approved; spend ≤ $5, PD-023): on the sim stack, `bun run lab demo-reset`; after run day 5, a trial export, then `bun run lab demo-export --day 5 --out <file>`; copy to the D6 path; record size and row counts in `notes/`. Backup: not needed (the reset touches only the demo org); rollback: none. Stage 09 waits for it.
- **C2** (after stage 11): cold-read scout, text in stage 11. Findings → stage 12.
- **G1** owner: read the built site, then empty `OWNER_REVIEW_PENDING`. Default: the list stays; no new page goes public.
- **G2** owner: commit the C1 seed at the D5 path (public repo). Default: not committed; shots stay on the e2e seed.
- **G3** owner: upload the stage 09 files to release `demo-video`. Default: not uploaded; no video on the site.

## Review

Review job before the land (`claude-opus-5-5`, high): stages 01, 02, 05, 07, 09, 10 (09 and 10 for the Polish captions and the home line). Others land on the worker's proof.

## Stages

- 01 [Publication hold and claim check](stages/stage-01-hold-and-claim-check.md) `[risky]` publication path.
- 02 [Security page (en)](stages/stage-02-security-page.md) `[risky]` security claims.
- 03 [Pricing page (en)](stages/stage-03-pricing-page.md).
- 04 [Home page (en)](stages/stage-04-home-page.md).
- 05 [Polish twins and strict set](stages/stage-05-polish.md).
- 06 [API and autonomy-evidence reference](stages/stage-06-reference.md).
- 07 [Shots from the demo seed](stages/stage-07-demo-shots.md) `[risky]` public data.
- 08 [Fake Telegram viewer](stages/stage-08-telegram-viewer.md).
- 09 [Demo record command](stages/stage-09-demo-record.md).
- 10 [Video on the site](stages/stage-10-video-on-site.md) `[risky]` deploy workflow.
- 11 [Close-out: axe, docs, cold-read pack](stages/stage-11-close-out.md).
- 12 (conditional) Cold-read fixes: only when C2 finds a mismatch; the coordinator writes it from the findings.

## How to run (coordinator)

Order: 01 first. Then 02 → 03 → 04 (one sidebar), 06 and 08 next to them. 05 after 04. 07 after 01. 09 after 08 and C1. 10 after 04 and 09. 11 after 05, 06, 07, 10. Stage 03 waits for F107 stage 08.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "F121-sNN <slug> · F121" \
  "Implement F121 stage NN. Read spec/features/active/F121-e10b-public-pages-and-demo/ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof of your stage, after the last commit. Claim only what a saved log shows."
```

Land each with `limen land <id> --yes --keep-open`; drop the job DB.

## Planning progress

- [written] ticket, plan, interfaces, questions, scouts (4 scouts), stages 01–11. Word counts in § Log.

## Cold review

Pending.

## Log

- 2026-11-19: written at `c68ce51e`. Words: plan ≤ 1,500, stages 318–614 (`wc -w`).
