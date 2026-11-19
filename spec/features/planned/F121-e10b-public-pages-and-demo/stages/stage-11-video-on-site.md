# F121 stage 11 — Video on the site

Needs stage 04: the home pages `index.mdx` and `pl/index.mdx` (the video place). Needs stage 01: the `publish_held_pages` input in `docs-deploy.yml` and the hold in `deployDecision` (both stages edit them). It uses a committed fixture video, not a stage 10 output: May run next to 09 and 10 (the release-checklist line that names `demo:record` is in stage 12). Playwright: lock rule until F136 lands.

Part of [`../plan.md`](../plan.md). `[risky]` deploy workflow: a new download step with a token. Decisions D8, P4, P5. Review before the land. Extra proof link: `flock /tmp/email-assistant-shared-tests.lock bun run docs:test > /tmp/f121-s11/site.log 2>&1` before `echo PROOF_OK`.

Carry-over reads: `.github/workflows/docs-deploy.yml`, `apps/docs/scripts/workflows.test.ts`, `apps/docs/integrations/csp-finalize.ts`, `packages/core/src/web/` (`docsCspProblem`, `publicContentScan`), `apps/docs/integrations/public-content.ts`, `apps/docs/src/components/Shot.astro` (on/off pattern), `docs/release-checklist.md`.

## Step 1 — Component and home

**Files.** New `apps/docs/src/components/DemoVideo.astro`; new `apps/docs/src/demo-video.ts`; `index.mdx` and `pl/index.mdx` (same place in both; re-stamp pl); `.gitignore` line for `apps/docs/public/demo/`; a committed fixture `apps/docs/e2e/fixtures/demo-1s.mp4` (1 s, black, < 20 KB) and two VTT.

**Decisions.**
- `DEMO_VIDEO_SHA256: string | null` in `demo-video.ts`, now `null` (review 1 N5: the pin). The deploy uses only a video whose hash matches; an upload with `--clobber` cannot change the site without a commit.
- `DemoVideo` renders only when the three files exist in `apps/docs/public/demo/` at build; else nothing, no empty box.
- `<video controls preload="metadata" playsinline>`, no autoplay; two `<track kind="captions">`, the page language as `default`. Under it (P5, Q2): "The demo organization is made-up data and has every feature on; some features are off by default." Polish twin. The line must pass the flagged-text test.
- CSP: if needed, only `media-src 'self'`, tested in `docsCspProblem`.
- MP4 H.264 stays (it plays in every common browser). Tests never play it (review 1 U1: Playwright's Chromium may lack H.264).

**Test.**
1. Build without files → home HTML has no `<video`.
2. Build with the fixture files → `<video` with two `<track>`; the CSP check passes.
3. Browser check with the fixtures: the `<video>` and both tracks exist; `GET` of the video URL answers 200 with type `video/mp4`; axe zero violations. No playback assert.

## Step 2 — Deploy download

**Files.** `.github/workflows/docs-deploy.yml`; new `apps/docs/scripts/demo-fetch.ts` and test; `workflows.test.ts`; `apps/docs/integrations/public-content.ts`.

**Decisions.**
- `demo-fetch.ts` runs in the build job before `docs:build`: when `DEMO_VIDEO_SHA256` is null it logs `demo_video off` and exits 0 (no download). Else it runs `gh release download demo-video --pattern 'demo*' --dir apps/docs/public/demo` with `GH_TOKEN` = `github.token`; a missing release or a hash mismatch → exit 1 (the owner pinned a video, so it must be there); a file over 20 MB → exit 1.
- The build job keeps `contents: read` only.
- The public-content scan also reads `.vtt` files (review 1 N11).
- The tag `demo-video` is not `v*`: no deploy trigger.

**Test.**
4. `demo-fetch` with the pin null → no download call, exit 0; with a pin and a fake downloader that writes a file of another hash → exit 1 `demo_video_hash`; with a matching file → exit 0.
5. `workflows.test.ts`: the fetch step runs before the build, with `GH_TOKEN` from `github.token`; build-job permissions unchanged.
6. Public-content scan: a `.vtt` in the built site with `jan@firma.pl` fails the build.
7. Deploy gate: tag `demo-video` → `skip: … not a release tag`.

**Check.** `bun test apps/docs/scripts apps/docs/src apps/docs/integrations`, `bun run docs:build`, the browser check under the lock.

**Done when.** Tests 1–7 pass; Proof prints `PROOF_OK`.

**Out of scope.** Uploading the video; setting the pin; running the deploy.
