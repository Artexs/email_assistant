# F121 questions (defaults taken; owner to confirm)

Part of [`plan.md`](plan.md). No blocking question. Each item has the default that the plan builds; the stages do not change with the answer unless the item says so.

## Gates (outside publication; default: prepare, do not publish)

1. **G1 [important: production] Publish the new pages.** The new home, security and pricing pages land in `master` but the docs deploy holds while `OWNER_REVIEW_PENDING` is not empty (D1). Default: the list stays; nothing new goes public. Owner step: read the built site (`bun run docs:build`, then `bun run --filter @ea/docs preview`), then the coordinator empties the list in one commit; the next release tag deploys. Consequence of the default: no docs deploy at all from the first F121 land until G1 (other tickets' doc changes wait too). Other option: Starlight drafts per page (home cannot be a draft; links break).
2. **G2 [important: irreversible] Commit the demo seed to the public repo.** The C1 export is synthetic (`.test` addresses, scanned), but a commit to the public repo cannot be taken back. Default: not committed; the file stays at `~/.local/share/email-assistant/demo/`; docs shots stay on the e2e seed. Owner step: OK → the coordinator commits it at `apps/web/e2e/demo/demo-seed.json` (only if < 5 MB, F113 rule).
3. **G3 [important: user-visible] Upload the demo video.** Default: not uploaded; the home page shows no video. Owner step: `gh release create demo-video tmp/demo/demo.mp4 tmp/demo/demo.en.vtt tmp/demo/demo.pl.vtt` (command in `deploy/README.md` after stage 10).

## Product defaults

4. **Q2 [important: user-visible] The video shows features that are off by default** (report, "Turn on recommended", panel approvals). Default: record the decision-12 script with those flags on in the demo org, plus a line under the video that the demo has every feature on and some are off by default (P5). Other option: cut the flagged steps (the video then shows shadow, urgent notice, delegation, Undo; about 1 minute). Changes stage 09 step list only.
5. **Q3 [important: scope] Autonomy-evidence reference covers only unflagged behaviour** (owner rule 2026-11-15: no docs for default-off flags; `trust_ladder` is off by default). Default: write only the unflagged part; skip the page when fewer than 3 facts remain. Pages for flagged F110 features wait until a flag turns on for everyone (no ticket yet).
6. **Q4 [minor] API reference lists flagged routes too.** Default: all routes of the public file, with one intro line that some routes answer only while a feature is on. Other option: hide flagged routes (needs a route → flag map that does not exist).
7. **Q5 [important: money] Placeholder price shown as $25 per mailbox per month in USD on both languages,** with margin per row. Default: as decision 11; no PLN.
8. **Q6 [minor] Demo seed day.** Default: run day 5 (shadow days 1–3 and two assist days, so the history has both the report and automatic moves).
9. **Q7 [important: user-visible] Product name.** Default: the working name `PRODUCT_NAME = "Email Assistant"` (decision 15) on the public pages; one constant to rename.
10. **Q8 [minor] OpenAPI copy in git.** Default: `docs/api/openapi.json` committed with a unit drift test (D4). Other option: build it inside the docs build (the docs build would load the server).
11. **Q9 [important: privacy] Security claims that the ledger marks `gap` or `unverified` are left out of the public page** (not shown with a caveat). Default: left out and listed in the close-out note. Other option: a "known gaps" section.

## Coordinator steps (no owner needed)

- **C1** demo week run and export on the VPS sim stack (pre-approved; spend inside PD-023's $5 per week run). Lead time ≥ 5 days: start at the build start.
- **C2** cold-read scout after stage 11.
