# F170 stage 03 — Settings: the reply style card

Needs F166 stage 02: `ui:sheet`, the a11y `schemes` option. Needs F166 stages 04, 05: the primitives. Needs F166 stage 08: `web:build:dev`, `patterns.spec.ts` (the Proof). Needs F166 stage 10: `SectionCard`, `RowList`, `Row`, `FactBox`. May run next to 01, 02, 04, 05, 06, 07, 08, 09, 10 (it does not touch `SettingsPage.tsx`).

Part of [`../plan.md`](../plan.md). Decisions: D1, D4, D5.

Owns: `ReplyStyleCard.tsx`, `StyleGuide.tsx`, `StyleSuggest.tsx`, `ReplySamples.tsx` (in `components/settings/`), `reply-style.spec.ts`, the render tests of these files (`reply-style-card.test.tsx`).

## Step 1 — The card

- **Decisions:**
  - `ReplyStyleCard` is a `SectionCard` (icon `PenLine`, title `rs_title`, `data-card="reply-style"`), the last card of the mailbox group, as today.
  - The display name and the signature are labelled fields (48 px input, 96 px textarea, DB-6). The writing style is a labelled textarea. Save is the `default` button; Preview and "Suggest my style from my sent mail" are `soft` buttons (mockup screen `settings`, card "Reply style"). The guided form (form of address, greeting, sign-off, length) is a `RowList` of selects with `htmlFor`.
  - "In use: <text>" under an empty field stays its help text (`aria-describedby` unchanged).
  - The preview answer is plain text in a muted box with "This is a sample. Nothing was sent."; it is a `FactBox` (a calm note), never markup.
  - `data-card-part="reply-samples"` and `data-card-part="style-suggest"` stay on their blocks.
- **Edge cases:** flag `reply_drafts` off: only the name and the signature show, as today. A member: read-only texts, no button, no guided form. The suggest button is inactive while `sentTracking` is not `on`, with today's line. `preview_limit`, `preview_busy`, `llm_off`, `llm_cap` keep their texts. A phone at 320 px: the buttons wrap; no sideways scroll.
- **Test:** (1) render test: with `isOwner: false` the card has no button and no combobox of the guided form. (2) Render test: the preview text `<b>Hi</b>` shows as the literal text, and the card has no `b` element. (3) e2e `reply-style.spec.ts` passes on both projects with its a11y scans, also the faked Preview answer.

## Step 2 — Docs

- Update the reply style part of `docs/capabilities/web-panel.md` rule 9 (the look only) and the user docs page that names the card (`apps/docs`, English and Polish), if a button name or a heading changed.

## Out of scope

The mode card and its reply-drafts switch (stage 02). Any profile rule, any check of `checkProfileInput`, any prompt.

## Done when

The sheet row `settings-reply-style` matches the mockup's "Reply style" card; the Proof of `../plan.md` with `reply-style.spec.ts settings.spec.ts` prints `PROOF_OK`.
