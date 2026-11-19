---
opened: 2026-11-13
---

# F121 · E10b Public pages and demo

## Outcome

A stranger reads on the public docs site what the product is (home), what it does with their mail (security and data, every claim with a proof link), what it would cost (pricing, placeholder), and sees it work (a two-minute demo video). The API and the autonomy evidence get reference pages, and the docs screenshots come from the synthetic demo organization. Nothing new goes public without the owner's OK: the plan prepares, the owner publishes.

## Scope

- Home and positioning, security and data, pricing (en and pl); proof-link check; deploy hold until the owner OK.
- API reference from the OpenAPI file; autonomy-evidence reference (unflagged parts only).
- Docs screenshots from the E2b demo seed; image-path check.
- Read-only viewer in the fake Telegram; `bun run demo:record` (Playwright, ffmpeg, captions en and pl); the video on the home page from a release asset.
- Cold read by a fresh agent, axe check, ADR 0030 and docs updates.

## Out of scope

- Real pricing, payment, a domain, SEO, analytics. Static status page (dropped, decision 14).
- User pages for features that a default-off flag gates (owner rule 2026-11-15).
- Changes to the sub-processor registry or the legal texts (F107; a change needs a `TERMS_VERSION` bump).
- The publication itself (owner gates G1–G3 in `plan.md`).

## Acceptance

- `bun run docs:build` holds home, security and pricing in en and pl; the build fails when a security claim links a file that does not exist.
- The pricing table equals `costToRun` at 50, 100 and 200 mails a day (unit test).
- A pushed `v*` tag does not deploy the docs while the owner-review list is not empty (deploy-gate test).
- `bun run demo:record` writes an MP4 of 100–130 s and captions in en and pl (e2e seed; the demo-seed video is the follow-up ticket's).
- The fake Telegram serves a read-only, escaped chat view on loopback.
- A cold-read agent with only the built site answers the ten buyer questions in line with the claims table.

## Slices

One job per stage; order in `plan.md` § How to run. No migration, no `bun.lock` change.

## Sequenced

- Plan after: none (F107, F110, F113, F114 have `stages/`).
- Build after: F113 (E2b), F100 (E3a, done), F110 (E4-B), F107 (E7-T4), F114 (E8b), all in `spec/features/done/`.
- Stage needs: stage 02 needs F138 stage 02 (registry without the gemini row); stage 10 needs coordinator step C3 (demo DB).
- Gate: C1 (demo week) gates no stage (owner, 2026-11-20); it starts after the F113 day run day-20261120-215c ends. Publication: owner gates G1 (pages), G2 (demo seed in git), G3 (video asset); default for each: prepare, do not publish.

## Notes

Source row: `docs/product/stage-2/05-execution-plan.md` §2.1 # 27. Epic: `docs/product/stage-2/epics/E10-go-to-market-readiness.md`, notes `E10-discovery-notes.md` §4. F112 (E10a, done) moved the API and autonomy-evidence reference here (owner-decisions 2026-11-15).
