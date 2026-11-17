# F112 stage 16 — First publication [risky]

Part of [`../plan.md`](../plan.md). Read P7, D10, O1, N1, Q4 and Q6 in [`../questions.md`](../questions.md). Needs stages 01–15 landed and CI green on `master` (jobs `ci`, `e2e`, `image`, `docs`).

`[risky]`: the first outside publication of the product. No worker job: the owner does O1, the coordinator does the checks. No code change unless a check fails; then a fix is a normal worker job with this stage's checks as its proof.

## Step 1 — Owner (O1)

**Owner, 2026-11-15: "it's a job for you to do."** The coordinator does O1 with the `gh` CLI (the token has admin on the repository). State:
- Done 2026-11-15: item 2. `github-pages` environment: custom deployment policies `master` (branch) and `v*` (tag). Check: `gh api repos/Artexs/email_assistant/environments/github-pages/deployment-branch-policies --jq '.branch_policies[] | {name,type}'`.
- Not done on purpose: item 1 (Pages source). While Pages is off, a pushed release tag cannot publish a half-built site (stages 10–12 and 15 are not landed). Do it at this stage, after stages 01–15 land:
  - Item 1: `gh api -X POST repos/Artexs/email_assistant/pages -f build_type=workflow` (if it exists: `gh api -X PUT repos/Artexs/email_assistant/pages -f build_type=workflow`). Check: `gh api repos/Artexs/email_assistant/pages --jq .build_type` prints `workflow`.
  - N3 tag ruleset (only admins create, move or delete `v*` tags): `gh api -X POST repos/Artexs/email_assistant/rulesets --input -` with `{"name":"release tags","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},"rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],"bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}`. Check: `gh api repos/Artexs/email_assistant/rulesets --jq '.[].name'`.
  - Item 3: `gh workflow run docs-deploy.yml --ref master`, then the checks of Step 2.
- The old owner text below stays as the reference of what each item means.

The coordinator asks the owner for these steps and waits (outside publication needs the owner's hands):

1. GitHub → repository Settings → Pages → Build and deployment → Source: "GitHub Actions".
2. Settings → Environments → `github-pages` → Deployment branches and tags: keep `master`, add the tag rule `v*` (N1: without it a tag deploy fails).
3. Actions → "Docs deploy" (the workflow of stage 05) → Run workflow on `master`.

## Step 2 — Coordinator checks

- **Goal:** the live site is the built site, with its rules.
- **Checks** (save output under `/tmp/f112-s16/`):
  - C1: the workflow run is green: `gh run list --workflow docs-deploy.yml --limit 1` shows `completed success`; both jobs ran (not the skip path).
  - C2: `curl -sS -o /tmp/f112-s16/index.html -w '%{http_code}' https://artexs.github.io/email_assistant/` prints `200`; the same for `…/pl/`, `…/start/`, `…/operate/install-and-run/`, `…/operate/release-checklist/`, `…/changelog/`.
  - C3: `index.html` holds one `<meta http-equiv="content-security-policy"` with `default-src 'self'` and no `'unsafe-inline'` in `script-src`.
  - C4: after `bun run docs:build` at the deployed commit: `DOCS_TEST_URL=https://artexs.github.io/email_assistant/ CHROMIUM_PATH=/usr/bin/chromium bun run docs:test` passes (stage 06 T1–T5 on the live site; T5 needs Pages to serve the site's `404.html`).
  - C5: `curl -sS https://artexs.github.io/email_assistant/shots/onboarding-en-desktop.png -o /dev/null -w '%{http_code}'` prints `200` (stage 12 shots in the artifact).
  - C6: the run log holds `public content checked in` and `links checked in` lines.
- **Done when:** C1–C6 hold; the coordinator writes the run id and C1–C6 into `plan.md` § Log.

## After

- ADR 0030: add the date of the first publication to its "Built" note (a docs commit by the coordinator or the next worker).
- The panel flag `docs_links` stays off. The owner turns it on per organization when wanted (`bun run org:flag`); not part of this stage.
- Rollback: run the workflow by hand on the last good tag `vX` (a manual run deploys any ref, stage 05 T6b), or push a fixed release tag. Only a tag that holds `docs-deploy.yml` and the docs app can be a target: `v0.1.0` (F114, before stage 05) cannot. Until the first such tag exists, the rollback is a fix on `master` and a manual run on `master`, or Pages "None". To take the site down, the owner sets Pages to "None" (Settings → Pages). Never a force push.
- Risk to other work: none on the VPS; the deploy touches only GitHub Pages.

## Carry-over from stage 05 review

- N3: the O1 text says the deploy gate is not a security control; set a tag ruleset for `v*` (who may create release tags) and limit branch deploys of the `github-pages` environment to `master`; until O1 is done the deploy job fails red and publishes nothing (review-5.md).

## Carry-over from stage 13

- The FLAGGED_TEXT scan of stage 07 (`flagged-text.test.ts`) did not exist when stage 13 landed: make sure it also scans the built changelog page (src/content or dist), and that the `site-map.test.ts` list has the changelog page (stage 13 note: `notes/2026-11-15-f112-s13-changelog.md`).
