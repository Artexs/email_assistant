# F112 stage 16 — First publication [risky]

Part of [`../plan.md`](../plan.md). Read P7, D10, O1, N1, Q4 and Q6 in [`../questions.md`](../questions.md). Needs stages 01–15 landed and CI green on `master` (jobs `ci`, `e2e`, `image`, `docs`).

`[risky]`: the first outside publication of the product. No worker job: the owner does O1, the coordinator does the checks. No code change unless a check fails; then a fix is a normal worker job with this stage's checks as its proof.

## Step 1 — Owner (O1)

The coordinator asks the owner for these steps and waits (outside publication needs the owner's hands):

1. GitHub → repository Settings → Pages → Build and deployment → Source: "GitHub Actions".
2. Settings → Environments → `github-pages` → Deployment branches and tags: keep `master`, add the tag rule `v*` (N1: without it a tag deploy fails).
3. Actions → "Docs deploy" (the workflow of stage 05) → Run workflow on `master`.

## Step 2 — Coordinator checks

- **Goal:** the live site is the built site, with its rules.
- **Checks** (save output under `/tmp/f112-s14/`):
  - C1: the workflow run is green: `gh run list --workflow docs-deploy.yml --limit 1` shows `completed success`; both jobs ran (not the skip path).
  - C2: `curl -sS -o /tmp/f112-s14/index.html -w '%{http_code}' https://artexs.github.io/email_assistant/` prints `200`; the same for `…/pl/`, `…/start/`, `…/operate/install-and-run/`, `…/changelog/`.
  - C3: `index.html` holds one `<meta http-equiv="content-security-policy"` with `default-src 'self'` and no `'unsafe-inline'` in `script-src`.
  - C4: after `bun run docs:build` at the deployed commit: `DOCS_TEST_URL=https://artexs.github.io/email_assistant/ CHROMIUM_PATH=/usr/bin/chromium bun run docs:test` passes (stage 06 T1–T5 on the live site; T5 needs Pages to serve the site's `404.html`).
  - C5: `curl -sS https://artexs.github.io/email_assistant/shots/onboarding-en-desktop.png -o /dev/null -w '%{http_code}'` prints `200` (stage 12 shots in the artifact).
  - C6: the run log holds `public content checked in` and `links checked in` lines.
- **Done when:** C1–C6 hold; the coordinator writes the run id and C1–C6 into `plan.md` § Log.

## After

- ADR 0030: add the date of the first publication to its "Built" note (a docs commit by the coordinator or the next worker).
- The panel flag `docs_links` stays off. The owner turns it on per organization when wanted (`bun run org:flag`); not part of this stage.
- Rollback: run the workflow by hand on the last good tag `vX` (a manual run deploys any ref, stage 05 T6b), or push a fixed release tag. To take the site down, the owner sets Pages to "None" (Settings → Pages). Never a force push.
- Risk to other work: none on the VPS; the deploy touches only GitHub Pages.
