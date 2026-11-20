# F121 stage 12: items left open (stages 10 and 11 not landed)

Part of [`plan.md`](plan.md). The task said that the needed stages were landed. At `master` `d0da4a7e`, stage 10 (`demo:record`, no script in `package.json`) and stage 11 (`DemoVideo`, `DEMO_VIDEO_SHA256`, the fetch step: no file) have no commit; their branches `limen/2026-11-20-f121-stage-10-demo-record-87dddc5b` and `limen/2026-11-20-f121-stage-11-video-on-site-7e1e389e` hold nothing. Stage 12 did the parts that do not depend on them and wrote no doc text for code that does not exist.

## Done in stage 12

- Step 1: the new pages (en and pl home, security, pricing; API and evidence reference = 8 pages) in the browser spec with axe at desktop and phone width; a unit test that each id of `OWNER_REVIEW_PENDING` is a page; Gemini only as "optional, off by default".
- Step 2 (part): ADR 0030 § Built (E10b); `docs/code-patterns.md` § Docs site; `notes/2026-11-20-f121-close-out.md`. `docs/capabilities/web-panel.md` rule 6 already holds the public OpenAPI copy and its drift test.
- Step 3: `apps/docs/cold-read.md` and `apps/docs/src/cold-read.test.ts`.

## Open: after stages 10 and 11 land

1. `docs/release-checklist.md`: add "When the demo flow changed: `bun run demo:record`; only a run that logs `demo_source demo` is a candidate; the owner watches it, uploads it to the release `demo-video` and the coordinator commits its sha256 to `DEMO_VIDEO_SHA256`."
2. `deploy/README.md` § docs: the owner step for the upload (`gh release create demo-video …` or `gh release upload demo-video … --clobber`), with the paths stage 10 writes.
3. ADR 0030 § Built (E10b): replace the "Not built yet" bullet with the video path (release asset `demo-video`, pinned by `DEMO_VIDEO_SHA256`, fetched in the deploy build).
4. `docs/code-patterns.md` § Docs site: "re-record the demo when the shown flow changes".
5. `notes/2026-11-20-f121-close-out.md`: check the G3 command and paths against stage 10 and 11.
6. Cold-read pack question 10: after G3 the video is the expected source (the file already says so).
7. Browser spec: the home page with a video (stage 11 owns its check); add nothing here unless it breaks axe at phone width.
