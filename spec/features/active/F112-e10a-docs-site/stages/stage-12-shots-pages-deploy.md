# F112 stage 12 — Screenshots on the pages and in the deploy

Part of [`../plan.md`](../plan.md). Read P5, D10 and stage 11. Needs stages 10 and 11.

Two steps.

## Step 1 — `<Shot>` on the pages

- **Goal:** the tutorial and the how-to guides show the panel, in the reader's language.
- **Files:** the `.mdx` pages of stages 07 and 08 and their Polish pages of stage 10.
- **Decisions:**
  - A `<Shot page="…" />` line where a step shows a panel page; at most one per section. The Polish page gets the same line in the same section.
  - `bodyHash` ignores `<Shot … />` lines (stage 04), so this stage leaves every `sourceHash` current. If `docs:stale` reports a stale page after the edit, a line other than a `<Shot>` line changed: undo that change. Never re-stamp in this stage.
- **Test:**
  - T1: `bun run docs:stale --strict` exits 0 with `stale: 0`.
  - T2: each `<Shot page>` value on a page is a page of `SHOTS`; the English and the Polish page of a pair have the same `<Shot>` lines in the same order (extend `polish.test.ts` of stage 10).
  - T3: `bun run docs:build` passes (`shots: off`).

## Step 2 — Deploy with shots

- **Goal:** each deploy makes the shots and runs every check of CI first.
- **Files:** `.github/workflows/docs-deploy.yml`.
- **Decisions:** in the `build` job, after the gate and only with `deploy=true`: the services and setup of the `e2e` job of `ci.yml` (Postgres, GreenMail, the DB roles and e2e DB, migrate, `web:build`, Playwright Chromium, a random `CREDENTIALS_KEY` from `openssl`), then `bun run docs:shots`, then `DOCS_SHOTS=on bun run docs:build`, then `bun run docs:test` (stage 06), then the upload. The PNGs go into the Pages artifact, never into git. The CI `docs` job stays without shots. The `build` job keeps only `contents: read` (stage 05).
- **Test:**
  - T4: the deploy YAML parses; the `build` job has the services `postgres` and `greenmail`; its steps run `docs:stale --strict`, `docs:shots`, `docs:build`, `docs:test` in this order before `actions/upload-pages-artifact`.
  - T5: no step of the workflow reads a repository secret (`secrets.` occurs nowhere in the file).
- **Done when:** T1–T5 hold; the workflow has not run.

## Proof

The plan's chain with `NN` = `12`, then `&& bun run docs:stale --strict > /tmp/f112-s12/stale.log 2>&1` before `&& echo PROOF_OK`.
