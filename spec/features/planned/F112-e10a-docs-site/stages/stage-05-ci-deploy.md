# F112 stage 05 — CI job, deploy workflow, ADR [risky]

Part of [`../plan.md`](../plan.md). Read P7, D9, D10, Q4 and Q6 in [`../questions.md`](../questions.md), facts F12, F13. Needs stage 04.

`[risky]`: this workflow publishes to the internet when it runs. The stage writes it; it never runs it (no tag, no manual run). Three steps.

## Step 1 — CI job `docs`

- **Goal:** every push and pull request builds the site with all checks.
- **Files:** `.github/workflows/ci.yml`.
- **Decisions:** a new job `docs` (no services): checkout, Bun from `.bun-version`, Node 24 (Astro 7 CLI, as `ci`), `bun install --frozen-lockfile`, `bun run docs:build`, `bun run docs:stale`. Stage 06 adds its browser check to this job. The file keeps `permissions: contents: read`.
- **Test:**
  - T1: `bun -e "console.log(Object.keys(Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()).jobs).join(' '))"` prints `ci e2e image docs`.

## Step 2 — Deploy workflow [risky]

- **Goal:** a release tag puts the docs of that release on GitHub Pages (ADR 0030 point 2).
- **Files:** `.github/workflows/docs-deploy.yml` (new), `apps/docs/scripts/deploy-gate.ts` (new) and test.
- **Decisions:**
  - Triggers: `push: tags: ["v*"]` and `workflow_dispatch` (no inputs: the run uses the ref chosen in the GitHub UI).
  - `permissions: contents: read, pages: write, id-token: write`; `concurrency: { group: pages, cancel-in-progress: false }`.
  - Job `build`: checkout with `fetch-depth: 0` (tags), Bun, Node 24, frozen install, the gate step, then `bun run docs:build` with `DOCS_GIT_REF` = the tag name or the commit sha of a manual run, then `actions/upload-pages-artifact` with `apps/docs/dist`. Job `deploy` (needs `build`, environment `github-pages`): `actions/deploy-pages`. Use the current major of each `actions/*` step and say which.
  - Gate: `deployDecision(ref: { type: "tag" | "branch"; name: string }, tags: string[]): { deploy: boolean; reason: string }` in `deploy-gate.ts`, run from the workflow with `github.ref_type`, `github.ref_name` and `git tag --list 'v*'`. On a tag that is not the highest SemVer `v*` tag, print `skip: <tag> is not the newest release (<newest>)` and set the output `deploy=false`; later steps run only with `deploy=true`. A manual run always deploys. A tag that is not SemVer (`v1`, `vtest`) → `deploy=false` with `skip: <tag> is not a release tag`.
  - Stage 11 adds the screenshot steps to `build`.
  - No secret other than the GitHub token; no `.env`.
- **Test** (`deployDecision`; tag refs unless named):
  - T2: `("v0.2.0", ["v0.1.0", "v0.2.0"])` → deploy.
  - T3: `("v0.1.1", ["v0.1.1", "v0.2.0"])` → skip, newest `v0.2.0`.
  - T4: `("v0.10.0", ["v0.9.0", "v0.10.0"])` → deploy (SemVer order, not text).
  - T5: `("vtest", ["vtest"])` → skip, not a release tag.
  - T6: `({ type: "branch", name: "master" }, [])` → deploy.
  - T7: the YAML parses; its jobs are `build deploy`; `deploy.environment.name` is `github-pages`.
- **Done when:** T2–T7 hold; the workflow has never run.

## Step 3 — ADR and rules

- **Goal:** the docs say how the site works.
- **Files:** `docs/decisions/0030-public-docs-site.md` (status accepted, with the date; a "Built" note: Starlight 0.43.1, the CSP pass of D3 with the two Q6 limits, the build checks, the deploy gate, the first deploy is the owner's), `docs/architecture.md` (one paragraph on the docs app in the layout and deployment parts), `docs/code-patterns.md` (a short § "Docs site": where a page goes, the `capabilities` field, `<UiText>`, `docs:stale --stamp` after a translation, the allow list needs a reason, PD-009 extension: a landed user-visible feature updates its user page in the same change), `docs/capabilities/README.md` only if its PD-009 line needs the path of the docs pages.
- **Test:**
  - T8: `bun test apps/server/src/capability-map.test.ts` passes (it checks paths in the capability pages).
- **Done when:** T8 holds; the texts name no host, no person and no tailnet.

## Proof

The plan's chain with `NN` = `05`, then `&& bun test apps/server/src/capability-map.test.ts > /tmp/f112-s05/capmap.log 2>&1` before `&& echo PROOF_OK`.
