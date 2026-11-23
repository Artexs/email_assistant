# F170 stage 02 — Settings: the mailbox cards

Needs stage 01: `useModeChange` in `ModeCard.tsx` and the mailbox group of `SettingsPage.tsx`. Needs F166 stage 06: `CategoryPill`, `categoryLook`. Needs F166 stage 10: `SectionCard`, `RowList`, `Row`, `FactBox`. May run next to 03, 04, 05, 06, 07, 08, 09, 10.

Part of [`../plan.md`](../plan.md). Decisions: P4, D1, D4, D5.

Owns: `ModeCard.tsx` (look), `AssistDialog.tsx`, `CategoriesCard.tsx`, `SetAnywayDialog.tsx`, `SyncFoldersCard.tsx`, `SentMailCard.tsx`, `LoopSettingsCard.tsx`, `MailboxSelector.tsx` (all in `components/settings/`), `trust-card.spec.ts`, `loops-panel.spec.ts`, `plan.spec.ts`. It uses `StatusBadge` and `ScopeBadges` unchanged (stage 07 owns them). New tests go into the specs this stage owns; `settings.spec.ts` (stage 01) runs read-only.

## Step 1 — Mode card and the mailbox head

- **Decisions:** `ModeCard` is a `SectionCard` (icon `Sparkles`, title `mode_title`, `data-card="mode"`). The current mode is a line with its name and text, then the one mode button (owner who can write). The switches are `Row`s in a `RowList` with `htmlFor` = the switch id (`switch_<name>`, `switch_reply_drafts`), so the title names the switch; the help lines of the reply-drafts switch are the `hint`, and `aria-describedby` keeps its two ids. `moves_unsupported` is a `FactBox`. `AssistDialog`: primitives only, the two choices as two full-width buttons with their hint under each, Cancel in the footer; it keeps its props (stage 06 uses it).
- **Mailbox head:** the selector (`MailboxSelector`, its `id="settings-mailbox"` stays), then the status badge and the scope badges in one wrapping row.
- **Test:** (1) render test: `ModeCard` with `toolSwitches` `{ move_spam: true, … }` has a switch with the accessible name of `switch_move_spam` that is checked; with `isOwner: false` every switch is disabled and no mode button shows. (2) The reply-drafts switch of an OAuth mailbox is disabled and has the description `rs_switch_help` + `rs_switch_oauth`.

## Step 2 — Categories, folders, sent mail, open loops

- **Decisions:**
  - `CategoriesCard` (`data-card="categories"`): one `Row` per category with a `CategoryPill` as `leading` (DB-8: no emoji), the switch at the end, the three evidence lines (Proof, Your mail, Paused) as the `hint`. "Set anyway" and its dialog (`SetAnywayDialog`) do not change their flow; the dialog lists the blocks as a list.
  - `SyncFoldersCard` (`folders`), `SentMailCard` (`sent`), `LoopSettingsCard` (`loops`): `SectionCard` + `Row`s; every control keeps its `id` and its `aria-describedby`. The "paused" state of the Sent card and the "turn on Track my sent mail" line are a `FactBox`.
  - Icons: categories `Filter`, folders `FolderSync`, sent `Send`, loops `Repeat`.
- **Edge cases:** a member sees every control disabled, as today; a suspended organization the same (`canWrite`). The Sent card shows only on today's condition (`sentSync !== null`); the loops card only while `toolSwitches.auto_follow_up` is in the answer.
- **Test:** (3) render test: `CategoriesCard` renders one `CategoryPill` per category of the settings view and no emoji character (a regex over the text). (4) e2e `trust-card.spec.ts`: the evidence lines and "Set anyway" work as before and the a11y scan passes. (5) e2e `loops-panel.spec.ts`: the loops card controls are disabled while sent tracking is off.

## Out of scope

The frame and the nav (stage 01). The reply style card (stage 03). The status and scope badges (stage 07). Any change of a switch rule or an API call.

## Done when

The pictures of `settings` with the trust and the open-loops seed states match the mockup's "What I do per category" card; the Proof of `../plan.md` with `settings.spec.ts trust-card.spec.ts loops-panel.spec.ts plan.spec.ts reply-style.spec.ts` prints `PROOF_OK`.
