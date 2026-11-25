# F171 stage 04 — Docs shots on the new pages

Needs the final look of the five shot pages and the frame: F167 stages 02, 03, 04 (frame, phone frame, banners and cards); F170 stage 06 (`/onboarding`), 07 (`/mailboxes`), 01–05 (`/settings`); F169 stages 06–10 (`/rules`); F168 stages 06, 07 (`/activity`). May run next to 01, 02, 03, 05 (it owns `apps/docs/src/shots.ts`, `shots.test.ts` and `apps/web/e2e/docs-shots/`).

Part of [`../plan.md`](../plan.md). Decisions P3, D9, D11. Opus review before the land.

## Step 1 — The shot run works on the new pages

- **Files:** `apps/web/e2e/docs-shots/shots.spec.ts` only where a wait or a locator no longer finds the page (the title check reads the `title_*` keys; the shell renders that title as the one `h1`, F166 stage 09).
- **Do:** run `bun run docs:shots`. It writes 20 PNG files into `apps/docs/public/shots/` (git-ignored). Each file is above `SHOT_MIN_BYTES`, and the last test of the spec (the file list) passes.

## Step 2 — Texts that describe the pictures

- **Files:** `apps/docs/src/shots.ts` (`E2E_ALT`, `DEMO_ALT`, `SHOT_TEXT_ALLOW` if a new allowed text is needed), `shots.test.ts` if a fixed text of a case changes.
- **Do:** open all 20 files. For each page, compare the English and the Polish alt text with the desktop and the phone picture. Rewrite a text that names a part that is gone, renamed or moved (D9). An alt text states what the page is for and what it shows; it names no flag-off feature (no text of `FLAGGED_PANEL_KEYS`; read the list) and passes `shotTextProblem`. `DEMO_ALT` follows only the words that changed in `E2E_ALT`.
- The shot list stays: 5 pages, 20 files, light scheme (P3).

## Step 3 — The site with the shots

- **Do:** `DOCS_SHOTS=on bun run docs:build`, then `bun run docs:test`. The pages with `<Shot />` (start, digest times, sender rules, in both languages) show the new pictures; the light and dark a11y passes stay green.

## Test

1. `shots.test.ts` passes, with "the default list is SHOTS: 20 files" unchanged.
2. The shot run log has 20 passed shot tests and the file-list test passed.
3. `shotTextProblem` gives no problem for each new alt text (existing case "the rules of the public-content check stop a page" stays green).
4. Break check: add to the English alt text of `rules` a word that a rule of `publicContentProblems` stops (take one from that function's own tests); the shot text test fails with `public_content <rule>` and the shot name `rules-en-desktop`; restore.
5. The docs build log says `shots: on` and the image check passes (no `image_outside`).

## Look

Copy the 20 PNG files to `/tmp/f171-04/shots/` (the reviewer opens them from another worktree) and give those paths. For each page, one line: what changed in its alt text, or "no change" and why the text still holds.

## Out of scope

New shot pages (approvals and delegations are flag-off). Dark shots (P3). The demo-week shots (F151 final take). The deploy that publishes them (it runs `docs:shots` in CI).

## Done when

- Tests 1–5 pass; test 4 failed when broken.
- `mkdir -p /tmp/f171-04 && bun run check:job > /tmp/f171-04/check.log 2>&1 && bun run web:build > /tmp/f171-04/web.log 2>&1 && bun run docs:shots > /tmp/f171-04/shots.log 2>&1 && DOCS_SHOTS=on bun run docs:build > /tmp/f171-04/build.log 2>&1 && bun run docs:test > /tmp/f171-04/docs.log 2>&1 && echo PROOF_OK` prints `PROOF_OK`.
