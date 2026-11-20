# Release checklist

Every VPS deploy is a release: a tagged version (a patch version is fine). Do the steps in this order. Commands for the VPS are in `deploy/README.md` § Release. What each script does is in `docs/capabilities/operations.md` § Releases.

1. **CI is green on the commit you tag.** Open the CI run of that commit on `master`. Do not tag a commit with a red or running CI.
2. **The changelog has the entry.** `CHANGELOG.md` has one line per user-visible change under `## [Unreleased]`, in product words (no ticket ids, no names of people). Groups: Added, Changed, Fixed, Removed, Security. The optional group `For users` holds what a user of the web panel can see, in two lines per item (`- en: <text>`, then `  pl: <text>` indented by two spaces); the form is in the comment at the top of `CHANGELOG.md`. The docs site publishes only this group, per release. `bun run release:prepare` keeps it.
3. **A model or prompt changed?** Attach the E2 holdout report to the release: `bun run eval --sim lab-01 --part holdout` (add `--judge` for a drafter change), with the report and the gate file under `evals/results/` committed. A prompt or model change with no such report does not ship.
4. **Sim stack (F113).** If a file of the sim stack changed (`deploy/compose.sim.yaml`, `deploy/Dockerfile.sim`, `deploy/sim.env.example`, the sim code), rebuild `ea-sim` on its host after step 9, from the checkout of the new tag (`deploy/README.md` § Sim stack, steps 1 to 6). A sim deploy never uses a bare commit.
5. **Owner-facing changes are in the capability pages** (`docs/capabilities/`), in the same change as the code.
6. **Migrations follow the contract rule.** `bun run db:check-migrations` passes. A migration works with the code of the previous release (`docs/code-patterns.md` § Migrations).
7. **The docs site has no stale Polish page.** `bun run docs:stale --strict` passes. A release whose tag is pushed also needs its `## [x.y.z]` entry in `CHANGELOG.md`: the docs deploy fails without it.
8. **Prepare, commit, tag, push.**
   ```sh
   bun run release:prepare <x.y.z>
   git add package.json CHANGELOG.md
   git commit -m "Release v<x.y.z>"
   git push                       # wait for green CI on this commit
   git tag -a v<x.y.z> -m "v<x.y.z>"
   git push origin v<x.y.z>
   ```
   `release:prepare` runs no git command. It refuses (exit 1, no file changed) a version that is not greater than the current one and an empty `[Unreleased]`; a version that is not `x.y.z` exits 2.
9. **Deploy on the VPS:** `deploy/release.sh v<x.y.z>`. The last output line is `release ok v<x.y.z> previous <old>`. Any other end is a failed release: go to step 11.
10. **Watch for 30 minutes.** No new `error` event in the log store (`docs/capabilities/logs.md`). `bun run ops:alerts` shows no open alert. Sync lines keep coming.
11. **On trouble:** `deploy/rollback.sh`. It needs no rebuild and never changes the database. Then fix forward in a new patch release. A rollback to a build older than the push sender (`v0.2.x`) needs the steps of `deploy/README.md` § Phone notices and Telegram detail → Roll back (step 5) first: that build fails its outbox claim on a push row.

When the demo flow changed (the video on the docs home page), the video is re-recorded. This is a separate step: it is not a part of the release and starts no deploy.

- Run `flock /tmp/email-assistant-shared-tests.lock bun run demo:record --seed <demo seed file>`. It writes `tmp/demo/demo.mp4`, `tmp/demo/demo.en.vtt` and `tmp/demo/demo.pl.vtt` and prints their sha256. A run is a candidate only when its log has `demo_source demo` and no line `demo_source e2e: not for upload`, and the video is 100 to 130 seconds and at most 15 MB. A run on the e2e seed proves the command only. (Until the demo-seed recording is built, `demo:record` on a demo seed stops with `demo_source_recording_not_built`: no candidate exists. Ticket: `spec/features/planned/F151-the-demo-video-and-the-docs-screenshots-come-from-the-synthetic-demo-week-export/`.)
- The owner watches the video, then uploads the three files to the release `demo-video` (`deploy/README.md` § Docs site, the owner steps).
- The coordinator then commits the three sha256 values to `DEMO_VIDEO_SHA256` and `DEMO_CAPTION_SHA256` in `apps/docs/src/demo-video.ts`. Without that commit the docs deploy downloads nothing.

A migration with a `-- contract: v<x.y.z>` line removes what the old code used. The release `v<x.y.z>` named there stopped that use. It must be deployed already, and it must be the release that you can roll back to. Check this before step 9.
