# F121 stage 10 — Video on the site

Part of [`../plan.md`](../plan.md). `[risky]` deploy workflow: a new download step with a token. Decisions D8, P4, P5. Needs stages 04 and 09. Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run docs:test > /tmp/f121-s10/site.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: `.github/workflows/docs-deploy.yml`, `apps/docs/scripts/workflows.test.ts`, `apps/docs/integrations/csp-finalize.ts` and `packages/core/src/web/` (`docsCspProblem`), `apps/docs/src/components/Shot.astro` (the on/off pattern), `docs/release-checklist.md`.

## Step 1 — Component and home

**Files.** New `apps/docs/src/components/DemoVideo.astro`; `index.mdx` and `pl/index.mdx` (re-stamp the pl hash); `.gitignore` line for `apps/docs/public/demo/`.

**Decisions.**
- `DemoVideo` renders only when `demo.mp4`, `demo.en.vtt`, `demo.pl.vtt` exist in `apps/docs/public/demo/` at build. Else it renders nothing, and the home page has no gap or empty box.
- `<video controls preload="metadata" playsinline>` with no autoplay, no sound track; `<track kind="captions">` en and pl, the page language as `default`. A text under it: "The demo organization is made-up data and has every feature on; some features are off by default." (P5; owner to confirm, Q2). Wording must pass the flagged-text test.
- The CSP check passes with the video: `media-src` same origin is enough; if the policy needs a change, it is the narrowest one (`media-src 'self'`) and `docsCspProblem` tests it.

**Test.**
1. Build with no files → the home HTML has no `<video`.
2. Build with three small test files (a 1-second test MP4 made by the test or a fixture of a few KB, and two VTT) → `<video` with two `<track>`; the CSP check passes.
3. Browser check with the files: the video element has `duration > 0` after `loadedmetadata`; axe zero violations.

## Step 2 — Deploy download

**Files.** `.github/workflows/docs-deploy.yml`; `workflows.test.ts`.

**Decisions.**
- In the build job, before `docs:build`: `gh release download demo-video --pattern 'demo*' --dir apps/docs/public/demo` with `GH_TOKEN: ${{ github.token }}`; the job keeps `contents: read` only. A missing release → the step logs `demo_video absent` and continues (exit 0); any other error fails the job.
- Size check after download: `demo.mp4` > 20 MB fails the job.
- The release tag `demo-video` is not `v*`, so it never triggers a deploy (test it in `workflows.test.ts`).

**Test.**
4. `workflows.test.ts`: the build job has the download step before the build, with `GH_TOKEN` from `github.token`, permissions of the build job unchanged (`contents: read`), and the step tolerates only a missing release.
5. The deploy gate test: tag `demo-video` → `skip: … not a release tag`.

## Step 3 — Release checklist and runbook

**Decisions.** `docs/release-checklist.md` gains: "When the demo flow changed: `bun run demo:record` and the owner uploads the files to the release `demo-video` (G3)". The G3 command for the owner (`gh release create demo-video …` or `gh release upload demo-video … --clobber`) is written in `deploy/README.md` § docs, marked as an owner step.

**Check.** `bun test apps/docs/scripts apps/docs/src`, `bun run docs:build`, the browser check under the lock.

**Done when.** Tests 1–5 pass; Proof prints `PROOF_OK`.

**Out of scope.** Uploading the video; running the deploy workflow.
