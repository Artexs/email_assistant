# F121 plan — E10b Public pages and demo

> **Status 2026-11-19 — planned.** Plan base: `c68ce51e`. 12 stages and one conditional fix stage; nothing built. [scouts.md](scouts.md), [questions.md](questions.md), [interfaces.md](interfaces.md).

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

- **D1** Publication hold: while `OWNER_REVIEW_PENDING` (the five new page ids) is not empty, a pushed tag does not deploy the docs (green skip); a manual run deploys only with the box `publish_held_pages`. Stage 01 sets it before any page lands; G1 empties it. Rejected: Starlight drafts (home cannot be one; links break).
- **D2** Claims: typed `publicClaims`; each cites ledger ids of `docs/legal/claims.md` and repo paths that those rows name. The build fails on a missing path, a weak row (`gap`/`unverified` anywhere in the source) or a missing condition. Rejected: hand-written links.
- **D3** Cost table renders `costToRun` at build; a test compares the built cells. One price constant in `site.ts`.
- **D4** OpenAPI: `bun run api:spec` writes `docs/api/openapi.json` from the app built with fakes; a unit drift test. Rejected: the server inside the docs build.
- **D5** Shots: the shot run imports the demo seed when `DEMO_SEED_FILE` (default `apps/web/e2e/demo/demo-seed.json`) exists, else it keeps the e2e seed (today). The committed file waits for G2.
- **D6** Demo seed: one export of run day 5 (shadow days 1–3, assist from day 4) by coordinator step C1; it lives outside git until G2 (`~/.local/share/email-assistant/demo/demo-seed-day5.json`, mode 0600).
- **D7** Recording runs on the e2e servers (LLM triage off) with its own `*_demo` database, under the shared lock, with the imported seed. It drives only the panel, product CLIs and GreenMail delivery, never raw SQL. A step that cannot run live shows its result from the seed state, and its caption says the day. More than two such steps = stop and ask.
- **D8** Video: `demo.mp4` (H.264, ≤ 15 MB) and two VTT, assets of the release `demo-video` (no deploy trigger), never in git. The deploy downloads them only when `DEMO_VIDEO_SHA256` is set and matches.
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
- `<video>` and `<track>` under the docs CSP (stage 11 browser check; no playback assert).
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

Stages 07, 10, 11, 12 add their own link to the chain (in the stage file).

## Coordinator steps and owner gates

- **C1** (start at the build start; VPS pre-approved; spend ≤ $5, PD-023): on the sim stack, `bun run lab demo-reset`; after run day 5, a trial export, then `bun run lab demo-export --day 5 --out <file>`; copy to the D6 path; `demo-reset --date` (else it waits for Monday); record size and counts in `notes/`. No backup needed (demo org only); rollback: none. Stage 09 waits.
- **C2** (after stage 12): cold-read scout, pack from stage 12. Findings → stage 13.
- **G1** owner: read the built site, then empty `OWNER_REVIEW_PENDING`. Default: the list stays; no new page goes public.
- **G2** owner: commit the C1 seed at the D5 path (public repo). Default: not committed; shots stay on the e2e seed.
- **G3** owner: watch and upload the stage 10 files; the coordinator pins the sha256. Default: not uploaded; no video.

## Review

Review job before the land (`claude-opus-5-5`, high): stages 01, 02, 03, 04, 05, 06, 07, 09, 11 (price, claims, Polish text, flagged routes, deploy). Others land on the proof.

## Stages

- 01 [Publication hold and claim check](stages/stage-01-hold-and-claim-check.md) `[risky]` publication path.
- 02 [Security page (en)](stages/stage-02-security-page.md) `[risky]` security claims.
- 03 [Pricing page (en)](stages/stage-03-pricing-page.md).
- 04 [Home page (en and pl)](stages/stage-04-home-page.md).
- 05 [Polish security and pricing, strict set](stages/stage-05-polish.md).
- 06 [API and autonomy-evidence reference](stages/stage-06-reference.md).
- 07 [Shots from the demo seed](stages/stage-07-demo-shots.md) `[risky]` public data.
- 08 [Fake Telegram viewer](stages/stage-08-telegram-viewer.md).
- 09 [Demo script: spike, steps, captions](stages/stage-09-demo-script.md).
- 10 [Demo record command](stages/stage-10-demo-record.md).
- 11 [Video on the site](stages/stage-11-video-on-site.md) `[risky]` deploy workflow.
- 12 [Close-out: axe, docs, cold-read pack](stages/stage-12-close-out.md).
- 13 (conditional) Cold-read fixes: only when C2 finds a mismatch; the coordinator writes it from the findings.

## How to run (coordinator)

Order: 01 first. Then 02 → 03 → 04 (one sidebar); 06 after 02; 08 next to them. 05 after 04. 07 after 01. 09 after 08 and C1. 10 after 09. 11 after 04 and 10. 12 after 05, 06, 07, 11. Stage 03 waits for F107 stage 08.

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "F121-sNN <slug> · F121" \
  "Implement F121 stage NN. Read spec/features/active/F121-e10b-public-pages-and-demo/ticket.md, plan.md, interfaces.md and stages/stage-NN-<slug>.md; build every step. Final proof: the Proof of your stage, after the last commit. Claim only what a saved log shows."
```

Land each with `limen land <id> --yes --keep-open`; drop the job DB.

## Planning progress

- [written] ticket, plan, interfaces, questions, scouts (4 scouts), stages 01–12; review 1 applied.

## Cold review

Model `claude-opus-5-5`, high: the plan has `[risky]` stages (publication, security claims, public data, deploy). Job `2026-11-18-f121-plan-review-9cb589a4`; result in [plan-review-1.md](plan-review-1.md): 3 blocking, 1 unverified, 17 notes; all fixed, none rejected. Per finding: [plan-review-1-response.md](plan-review-1-response.md).

## Log

- 2026-11-19: written at `c68ce51e`; review 1 applied. Words: plan ≤ 1,500, stages ≤ 700 (`wc -w`).
