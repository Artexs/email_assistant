# F101 · Panel to Astro 7: plan

> **Status 2026-11-14 — planned.** Plan base: 560e74e7, refreshed 2026-11-14 ([plan-refresh-1.md](plan-refresh-1.md)). 4 stages; cold review 1 done and fixed. Nothing is built yet.

Ticket: [ticket.md](ticket.md). Defaults: [questions.md](questions.md). Probe facts F1–F13 and R1: [probes/facts.md](probes/facts.md).

## Planning progress

- [x] Decisions P1–P2, D1–D12; stages 01–04; cold review 1 ([plan-review-1.md](plan-review-1.md)).
- [x] Refresh 1 at `560e74e7`: re-probe R1; lean trim.

## Input

Job instruction (2026-11-14): plan F101; no owner checkpoints; owner steps only for the owner's hands; small questions get defaults. It says "PD-098 area"; the Astro 7 decision is PD-097.

Binding: E10 discovery decision 3 (PD-097, owner "Go with defaults.", 2026-11-13): the panel moves to Astro 7 in its own ticket before E4-A builds pages. ADR 0016: `script-src` never has `'unsafe-inline'`. `spec/build.md` NEXT: VPS steps are pre-approved for the coordinator (backup first, rollback target, verify after).

### Product decisions

- **P1** One Astro major in the workspace, before F102 adds pages and F112 adds Starlight. Rejected: two majors (two Vite majors, one lockfile).
- **P2** No visible change: same pages, texts, font, CSP directives. Reason: a platform move.

### Design decisions

- **D1 Versions.** Exact pins `astro` `7.4.12`, `@astrojs/react` `7.1.9`; Tailwind (both) `^4.3.5`; `@astrojs/astro2tsx` 0.1.4 by `bun update` (F6). Nothing else. Reason: CSP hashes and islands come from the pinned two, the probed versions; Tailwind 4.1 rejects Vite 8 (F1). Rejected: caret `astro`; Astro 6 between; an unprobed 7.x.
- **D2 CSP option.** `experimental` becomes `security`; the `csp` object with 7 directives stays (F2). Rejected: `security: { csp: true }` (drops them).
- **D3 Markdown highlight off** (`markdown: { syntaxHighlight: false }`). Reason: no Markdown; Shiki warns on CSP builds (F9). Rejected: Prism; ignoring it.
- **D4 CSP build check (stage 01).** The integration `apps/web/integrations/csp-style-src.ts` relaxes `style-src`, then checks every built page. Failure cases: stage 01 `CspProblem`, and a build with no page. Log: `csp checked in <n> page(s)`. Reason: a lost CSP passes in silence today; D2 changes its option. Lands on Astro 5 first. Rejected: a CI script; an e2e meta test (visited pages only).
- **D5 Node 24 in the CI `ci` job** (`actions/setup-node@v4`, as in `e2e`). Reason: the Astro 7 CLI needs Node `>=22.23.4`, the runner has exactly that and changes image; the server image has no Node, Bun runs the CLI (F10). Rejected: `bun --bun` in the `web:build` script.
- **D6 No page or island change** (output equal after normalization, F4, R1). Exceptions: (a) a narrow fix when the Rust compiler rejects an `.astro` file that landed after the plan (F12), named in the final message; (b) one `@theme` block in `apps/web/src/styles/global.css` that sets `--font-sans` to the Tailwind 4.1 stack (F13). Rejected for (b): the new stack (visible). Any other source change is a question.
- **D7 No `astro dev` in agent sessions** (Astro 7 backgrounds it, F11); stage 03 documents the stop.
- **D8 Docs (stage 03):** ADR 0016 amendment, architecture §7, `docs/capabilities/web-panel.md` (PD-009), `README.md`, the Astro note. Reason: ADR 0016 names `experimental.csp`.
- **D9 Own VPS deploy (stage 04)**, then close. Reason: F102 and F112 wait for `done/`; an instant check ties a fault to this change. Rejected: the next normal deploy.
- **D10 Rollback.** `git revert -m 1 <merge commit of the stage 02 land>`; never a force push. VPS: tag `ea-server:pre-f101`. No migration.
- **D11 One lockfile change at a time.** Only stage 02 changes `bun.lock` or a `package.json`; it starts only when no other job changes `bun.lock`.
- **D12 Seams.** F112 pins the same `astro` (Starlight 0.43.1 needs `^7.2.10`, R1). Web pages of F105, F106, F119, F102 that land first: D4, D6 (a), page-count rule.

### Edge cases (answered)

- Stored state, crash and repeat, tenants, clocks: none changes.
- Two runs at once: D11; e2e lock.
- A page without CSP on purpose: none; D4 fails it; that ticket changes the check.
- Secrets: no stage reads or prints `.env`; the runbook prints no `.env` value, tailnet name or address.

## Not verified

- **N1** Image build on Astro 7 → C1 (`image` job).
- **N2** Full e2e, Radix scroll-lock style → stage 02 Proof.
- **N3** `ci` job on Node 24 → C1.
- **N4** Vite 8 dev proxy `timeout: 95_000` → open; stage 03 notes it.
- **N5** Panel on the VPS → stage 04.
- **N6** Firefox, Safari → not checked here.

## Done when

1. `bun.lock` has one `astro` entry, `astro@7.4.12`, and `@astrojs/react@7.1.9`; frozen install passes.
2. A broken CSP meta fails the build (stage 01 tests 1–17); stage 02 logs `csp checked in 18 page(s)`.
3. CSS custom properties keep their values (stage 02 test 8).
4. Each stage's Proof prints `PROOF_OK`.
5. Full e2e passes on `desktop` and `mobile`, no CSP violation.
6. The first `master` CI run after stage 02: `ci`, `e2e`, `image` green (C1).
7. The stage 03 docs say Astro 7, `security.csp` and the check.
8. The VPS serves the Astro 7 panel with the CSP meta (stage 04).

## Rules for every stage

- Read `CLAUDE.md`, `.agents/limen/styleguide.md`, the ticket, this file and your stage. Build only your stage.
- Format only your files; commit by explicit path after `git diff --staged`.
- Never read, print or copy `.env` or a secret.
- Only stage 02 changes `bun.lock`, a `package.json`, or `apps/web/src/` (D6 only).
- Never run `astro dev` or `web:dev` (D7).
- e2e: own DB (stage 02 Step 3), `CHROMIUM_PATH=/usr/bin/chromium`, always under `flock /tmp/email-assistant-shared-tests.lock`.
- Do not edit `spec/build.md`, `docs/product/stage-2/*` or another ticket. A gap or deviation is a question, not a choice.

## Proof

One bash call after the last commit; read logs separately; claim only what a saved log shows. `18` = pages at `560e74e7` (R1); if pages landed since, use `find apps/web/dist -name '*.html' | wc -l` and say so.

Stage 01:

```
mkdir -p /tmp/f101-s01 && bun run lint > /tmp/f101-s01/lint.log 2>&1 && bun run typecheck > /tmp/f101-s01/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f101-s01/unit.log 2>&1 && bun run test:int:ci > /tmp/f101-s01/int.log 2>&1 && bun run web:build > /tmp/f101-s01/web.log 2>&1 && grep -q 'csp checked in 18 page(s)' /tmp/f101-s01/web.log && echo PROOF_OK
```

Stage 02 (the Bun-only build mirrors the image; test 8 has its own saved files):

```
mkdir -p /tmp/f101-s02 && bun install --frozen-lockfile > /tmp/f101-s02/install.log 2>&1 && bun run lint > /tmp/f101-s02/lint.log 2>&1 && bun run typecheck > /tmp/f101-s02/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f101-s02/unit.log 2>&1 && bun run test:int:ci > /tmp/f101-s02/int.log 2>&1 && bun run web:build > /tmp/f101-s02/web.log 2>&1 && grep -q 'csp checked in 18 page(s)' /tmp/f101-s02/web.log && bun --bun run --cwd apps/web build > /tmp/f101-s02/web-bun.log 2>&1 && grep -q 'csp checked in 18 page(s)' /tmp/f101-s02/web-bun.log && flock /tmp/email-assistant-shared-tests.lock env CHROMIUM_PATH=/usr/bin/chromium bun run test:e2e > /tmp/f101-s02/e2e.log 2>&1 && echo PROOF_OK
```

Stage 03 (`<files>` = its Markdown files):

```
mkdir -p /tmp/f101-s03 && bunx prettier --check <files> > /tmp/f101-s03/prettier.log 2>&1 && bun run lint > /tmp/f101-s03/lint.log 2>&1 && bun run test:unit:ci > /tmp/f101-s03/unit.log 2>&1 && echo PROOF_OK
```

## User checkpoints and steps

None for the owner. Coordinator: **C1** after stage 02 lands, the first `master` CI run into § Log; **C2** after stage 03, stage 04.

## Review

Stages 01 and 02 get a review job before the land (`claude-sonnet-5-5`, high). Text: "Review F101 stage NN on <B> against the F101 plan.md and stage file: each numbered test and cited decision. Stage 01: try to pass a page with no CSP or an unsafe source. Stage 02: CSP meta of every page against ADR 0016; `bun.lock` only as F8 and R1; test 8; e2e 0 failures; no `apps/web/src` change outside D6. Quote file and line."

## Stages

- 01 [CSP build check](stages/stage-01-csp-build-check.md): every built page, on Astro 5.
- 02 [Astro 7](stages/stage-02-astro-7.md) `[risky]` dependencies, CSP: versions, lockfile, config, font, CI Node, e2e.
- 03 [Docs](stages/stage-03-docs.md): ADR 0016, architecture, capability page, README, note.
- 04 [VPS deploy](stages/stage-04-vps-deploy.md) `[risky]` real system: coordinator only.

Order 01 → 04, each landed before the next.

## How to run (coordinator)

1. Spawn:
   ```
   limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
     --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
     --prepare 'bash scripts/limen-prepare.sh' --label "F101-sNN <slug> · F101" \
     "Implement F101 stage NN. Read spec/features/active/F101-panel-to-astro-7/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step. Final proof: your stage's Proof command of plan.md, after the last commit; read logs separately. Claim only what a saved log shows."
   ```
2. Stage 02 only while no other job changes `bun.lock` (D11).
3. Stages 01, 02: review (§ Review); a finding → `limen continue`; 2 rounds, then the owner.
4. `limen land <job-id> --yes --keep-open`; drop the job DB (after stage 02 also `f101_s02_e2e`).
5. Land conflict → `limen continue` "merge master, fix, Proof again"; `bun.lock`: take `master`'s, redo stage 02 Step 1. Red C1 → D10.

## Cold review

Review 1 (Opus 5.5): FAIL, 1 blocking, 8 notes; all fixed. Refresh 1 changed no interface, schema or stage order: no new review.

## Log

- 2026-11-14: planned (Opus 5.5); cold review 1 fixed.
- 2026-11-14: refresh 1, `a72b214` → `560e74e7` ([plan-refresh-1.md](plan-refresh-1.md)).
