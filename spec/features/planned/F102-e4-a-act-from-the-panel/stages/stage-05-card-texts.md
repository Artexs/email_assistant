# F102 stage 05 — Card texts

Part of [`../plan.md`](../plan.md). Read D2, D4, D5, D12. Needs stage 04 landed. Core only. New Polish text: the review uses `claude-opus-5-5`.

## Step 1 — Approval view fields and card lines

- **Goal:** the Telegram approval card can show the version and the panel link.
- **Files:** `packages/core/src/notices/views.ts` (approval view schema), the `ApprovalView` type, `packages/core/src/digest/approvals.ts` (`renderApprovalRequest`), `packages/core/src/texts/approvals.ts`, tests.
- **Interfaces:** `ApprovalView` gains optional `version?: number` and `panelUrl?: string` (an `https://` or `http://` URL, at most 300 characters). Optional, so the rows of the last 24 h still parse (`docs/code-patterns.md` § Notices are facts).
- **Texts** (`approvals` texts, both languages):
  - `versionLine(n)`: en `✏️ Version ${n}, edited in the panel.`; pl `✏️ Wersja ${n}, zmieniona w panelu.` Shown below the title only when `version` ≥ 2.
  - `panelLine(url)`: en `Open in panel: ${url}`; pl `Otwórz w panelu: ${url}`. Shown directly above `sendLine` when `panelUrl` is set.
- **Test:**
  - T1: a view without the new fields renders the same text as on `master` (en and pl).
  - T2: `version: 2` adds the en line `✏️ Version 2, edited in the panel.` as the second line.
  - T3: `panelUrl: "https://ea.example.ts.net/approvals?id=7f1c0d1e-0000-4000-8000-000000000001"` adds `Open in panel: …` above the send line; pl `Otwórz w panelu: …`.
  - T4: with both fields and the T10 body of stage 04, the text is still at most 4096 characters and keeps both lines (the quote shrinks).
  - T5: `panelUrl` = `"javascript:alert(1)"` fails the view schema.
- **Done when:** T1–T5 pass.

## Step 2 — The `changed` outcome, tap answer, phrase

- **Goal:** the texts for a draft that a panel edit replaced.
- **Files:** `ApprovalEditOutcome` and `approvalEdit` (`packages/core/src/digest/approvals.ts`), `packages/core/src/texts/approvals.ts`, `packages/core/src/texts/bot.ts`, `packages/core/src/texts/would-do.ts` and the phrase code (`core/digest/would-do.ts`), tests.
- **Texts:**
  - Edit outcome `changed` (`edit.changed(time)`): en `✏️ Changed in the panel ${time}. The new version comes as a new message.`; pl `✏️ Zmieniono w panelu ${time}. Nowa wersja przyjdzie w osobnej wiadomości.`
  - Tap answer `taps.changed`: en `This draft was changed in the panel. Use the newest message.`; pl `Ten szkic zmieniono w panelu. Użyj najnowszej wiadomości.`
  - Phrase of a send or draft that ended `expired` / `superseded` (D12): en `changed in the panel (new version)`; pl `zmieniono w panelu (nowa wersja)`. It replaces "not sent (approval expired)" for that reason only.
- **Test:**
  - T6: `approvalEdit` with outcome `changed` at 14:05 (time zone `Europe/Warsaw`) appends `✏️ Changed in the panel 14:05. The new version comes as a new message.` and the card has no buttons.
  - T7: the pl texts of T6 and of `taps.changed` equal the strings above.
  - T8: the phrase for a `send` with status `expired` and reason `superseded` is the new phrase in en and pl; reason `timeout` keeps the old phrase.
  - T9: `packages/core/src/texts/locale.test.ts` and `index.test.ts` pass (every key in both languages).
- **Done when:** T6–T9 pass.
- **Out of scope:** the `approval_edit` notice kind and its registry entry (stage 09: it needs the stage 06 CHECK); where the server sets `panelUrl` (stage 09).

## Done when (stage)

- Steps 1 and 2 hold. The Proof of `plan.md` prints `PROOF_OK` (`/tmp/f102-s05`).
