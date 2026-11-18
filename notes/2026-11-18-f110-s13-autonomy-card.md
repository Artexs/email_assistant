# F110 stage 13: autonomy card (notes for stages 14, 15 and 25)

Code: `apps/web/src/lib/trust-card.ts` (pure: `proofLine`, `mailLine`, `pausedLine`, `blockLines`, `refusalBlocks`, `showRatingsLine`, `trustLines`), `trust-api.ts` (`loadTrustView`, `reportPath`), `components/settings/CategoriesCard.tsx` and `SetAnywayDialog.tsx`, `islands/SettingsPage.tsx`. Texts: block `F110 stage 13` at the end of `en.ts` and `pl.ts` (keys `trust_*`).

## What the card does

- The page asks for `GET /api/trust/:mailboxId` only when `me.features` holds `trust_ladder`. Flag off: no request (a 404 would be a console error in the e2e specs), the card is as before F110. A view that fails to load (any `ApiError`) also gives the old card.
- With the view the switch shows `categories[c].auto` (what triage reads under the running key), not the stored `auto` (stage 04 review N3). A category that is on under another model shows off.
- Lines per category: Proof (global), Your mail (history; moving categories only), Paused (red, only when tripped). The old ratings line shows only from `minKept` rated mails when the view is there (flag off: as before).
- A refused switch (409 `no_go`): the dialog lists one fixed phrase per `EvidenceBlock` and no gate text (stage 04 review N3/N4). The blocks come from the 409 body; the blocks of the view are the fallback (`refusalBlocks`). Confirm sends `force: true`.
- "See the report" links to `/report?mailbox=<id>` once a check exists. The page comes in stage 14: until then the link leads to a missing page (the flag is off for everyone).
- `inconclusive` history has its own line (`trust_mail_unclear`): the stage text had four phrases only. `too-few` and `no-go` global both read "Not proven".

## E2E seed

- One trust organization per project (`e2e-seed.ts`, rows in `e2e-trust-rows.ts`): flag `trust_ladder` on, one assist mailbox, a done check (`info`, `notification` pass; `spam` fail 6 of 60) and an active trip on `info`.
- The e2e server pins the classifier (`E2E_LLM_PIN` in `e2e-seed-args.ts`: openai, gpt-6-luna, effort none, default endpoint) and reads `GATE_EVIDENCE_DIR=apps/web/e2e/gate-fixture` (one non-provisional file, `info`, `notification`, `spam` go at 99.1% on 200 cases). The committed gate files are untouched. `e2e-gate-fixture.test.ts` (unit lane) fails when the pin, the prompt pointer or the fixture drift apart.
- The flag-off test reads the urgency organization of the project (its flag is `urgency_editor` only).

## Limits

- Stage 14 can reuse `proofLine`/`mailLine`/`pausedLine` for the report lines ("the global line, as the card").
- No flag, no route, no migration, no registry change; no `TERMS_VERSION` bump needed (the card shows counts and fixed phrases only).
