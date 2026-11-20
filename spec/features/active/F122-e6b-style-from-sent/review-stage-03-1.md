PASS dbb4d2c9fa5145bc99ccb71a71495a2c0f9d917c

I reviewed commit `dbb4d2c9fa5145bc99ccb71a71495a2c0f9d917c`. `git rev-parse HEAD` in the worktree gives the same commit, and the tree is clean. I found no blocking finding. The style card button works as stage 03 asks (`stage-03-style-card.md`, `interfaces.md`). The Polish texts are correct and keep the English meaning, and the note tells the user that sent mail goes to the AI provider (review note N9 of `plan-review-1.md`).

**Unverified**
- **e2e T13–T15 did not run.** The task said to run no suite, and the worker did not run them either. I read them against the card (below). This check would prove the candidate wrong: `bun run test:e2e -- reply-style` on this commit, in its own e2e DB and ports. The highest risk is the seed change: the reply-style organization now also has the flags `style_from_sent` and `sent_sync` on, and that could change what T1–T12 see.
- **Unit tests and `check:job` did not run in this review.** This review runs no suite. I did not see a `check:job` line from the worker, and I did not check one.

**Acceptance, checked by reading the code at HEAD**
- **Texts in en and pl.** Every visible string goes through `t()` or `tp()`. There is no literal text in `StyleSuggest.tsx` or `StyleGuide.tsx`.
  - The 10 `rs_suggest_*` keys are in `texts/en-reply.ts` and `texts/pl-reply.ts`.
  - The plural `rs_suggest_result` is in `enPlurals` and in `plPlurals` (one, few, many).
  - `PL_TEXTS` in `i18n/reply-style.test.ts` fixes the Polish texts. The new key `rs_suggest_running` ("The assistant is reading your sent mail…") is not in the stage list. It is reasonable.
- **AI provider note (N9).** The pl note says "Jednorazowo wysyła do dostawcy AI maksymalnie 100 wiadomości wysłanych z tej skrzynki w ostatnich 14 dniach. Zachowany zostanie tylko tekst, który zapiszesz." It keeps all facts of the English: once, up to 100, this mailbox, 14 days, AI provider, only the saved text is kept.
- **Name of the switch.** `rs_suggest_sent_off` uses the real Polish label „Śledź moją wysłaną pocztę” (`pl-settings.ts` `sent_switch`). This matches `lset_needs_sent`. The English line also matches `sent_switch`.
- **State table** (`suggestButton`, `lib/style-suggest.ts:25`):
  - member → hidden;
  - either flag off → hidden;
  - OAuth mailbox → off, with the line `rs_switch_oauth` (as the reply drafts switch);
  - `sentTracking` not `on` → off, with the sent line;
  - else → active.
  - `test.each` has 8 rows and covers the 4 rows of the stage.
- **Answer table.** All 11 route answers of `interfaces.md` have a row in `style-suggest.test.ts`. That is 6 of 200, 3 of 409 and 2 of 429. `llm_off` and `llm_cap` use the preview texts. `checks`, `output`, `provider` and unknown reasons use `rs_suggest_failed`. A 500, an unknown 409 or a 429 of another kind is thrown, and the card shows an alert.
  - `styleSuggestionConflictSchema` is strict. The server bodies (`replies/routes.ts:133-142`) match it exactly.
- **"Use this text" sends no PUT.**
  - "Use this text" calls `edit("writingStyle", text)`. That function only changes the draft state (`ReplyStyleCard.tsx:78`). Then the card focuses the textarea.
  - Only `save()` writes. `useDraft` does not keep a draft across a reload, and the code has no `beforeunload` handler. So the reload check in T14 is a valid proof that nothing was saved.
- **too_few.** It shows the note with its count (`role="status"`) and no box. A unit test covers this (`style-suggest-card.test.tsx`).
- **Plain text and busy button.** The suggestion is a React text child. An unit test checks that `<img>` does not render as markup. The button is off while the call runs.
- **e2e tests, read against the card:**
  - **T13** checks the sent line for the owner, the OAuth reason line and that a member sees nothing. In the card, `rs_switch_oauth` renders only from the suggest part (`ModeCard` is outside it), so `.first()` does no harm.
  - **T14** holds the faked route and checks that the button is off. It checks the plain text with `<b>`, the count line, that the field keeps the old value, axe with the box open, that "Use" fills and focuses the field, and that only a POST went out. A reload shows an empty field, and Save plus a reload keeps the text. This covers stage-03 Step 2 tests 1 and 3.
  - **T15** checks Discard, then 6 refusal answers with exact texts, then one real route call.

**Notes**
- **The stage asked for a component test of the click; the worker wrote an e2e test.** Stage-03 Step 2 test 1 asks for a component test that "Use this text" fills the field and sends no PUT. The unit component tests only render static markup, so they do not click. T14 (e2e) covers the click and the no-PUT. The repo has no DOM test library, so this is a reasonable choice. Plausible, not blocking.
- **The last T15 check is weak.** The real route call only checks that `[data-suggest=shown]` is visible. It does not check the text `en.rs_preview_llm_off`. Any note, for example `too_few`, would pass. Proposed fix: `toHaveText(en.rs_preview_llm_off)`. Rule 18 says an e2e server with no model client answers `200 failed llm_off`. Found by reading.
- **The Polish result head sounds stiff.** `rs_suggest_result` "Podstawa: {count} wysłane/wysłanych wiadomości" reads like a form label. "Na podstawie 1 wysłanej wiadomości" / "Na podstawie {count} wysłanych wiadomości" is more natural and keeps the English meaning. The few and many forms are the same in the genitive. The stage let the worker choose the Polish, so this is quality, not a break. If it changes, update `style-suggest.test.ts` and the plural table.
- **Small Polish style points (optional):**
  - `rs_suggest_too_few` drops "yet". "Na razie za mało wysłanych wiadomości ({count} z 5)…" keeps it.
  - `rs_suggest_note`: "z ostatnich 14 dni" or "w ciągu ostatnich 14 dni" reads better than "w ostatnich 14 dniach". The words "wysyła … wysłanych" repeat.
  - `rs_suggest_failed`: "Tym razem bez propozycji." is short and choppy. "Tym razem nie udało się przygotować propozycji." is more natural.
  - The "Twoje" capitals follow the repo style.
- **`sentTracking: "flag_off"` shows a line the owner cannot act on.** It gives "Turn on 'Track my sent mail'", but with the `sent_sync` flag off the Sent card and its switch do not show. `lset_needs_sent` in `LoopSettingsCard` does the same, and the stage text ("else it is off with the line") allows it. Plausible UX note.
- **The suggest button stays on while Save runs.** It is not disabled while `pending` (Save) runs. Harmless; it is a note only.
- **Seed change may start a sent-mail sync.** The seed now turns `sent_sync` on, and T14 and T15 turn sent tracking on for `box`. A background sent-mail sync against GreenMail may run during those tests. `reset()` turns it off again. Unverified, low risk.
- **Docs.** Rule 19 in `docs/capabilities/reply-drafts.md` and the `web-panel.md` paragraph describe the built behaviour correctly.

**Checks run**
- `git rev-parse HEAD && git status --short`: `dbb4d2c9fa5145bc99ccb71a71495a2c0f9d917c`, which matches the candidate; the tree is clean.
- Read the diff and context only: `git show`, `grep`, `sed`, `wc`. `ReplyStyleCard.tsx` has 338 lines and `StyleSuggest.tsx` has 112, so both are under 400.
- No `bun`, test, lint or typecheck command ran, as the task said.

**Note check**
- HEAD is the candidate: proven. `git rev-parse HEAD && git status --short` gave `dbb4d2c9…`.
- rs_suggest_* keys in en and pl, Polish keeps the meaning, N9 provider note: proven. `apps/web/src/i18n/texts/en-reply.ts`, `apps/web/src/i18n/texts/pl-reply.ts`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/pl.ts`. The quality notes above are not blocking.
- State and answer tables match stage-03 Step 1 and interfaces.md (11 answers), Use with no PUT before Save, too_few as a note with no box: proven by reading. `apps/web/src/lib/style-suggest.ts`, `apps/web/src/components/settings/StyleSuggest.tsx`, `apps/web/src/components/settings/ReplyStyleCard.tsx`. I did not run the unit tests.
- e2e T13–T15 assert what stage-03 Step 2 asks: proven by reading only. `apps/web/e2e/tests/reply-style.spec.ts`. They did not run, so passing is not proven; the task bars a suite run.
- Easy-to-miss rule "Run no suite": followed. No bun, test, lint or typecheck command ran in this session.
- Reminder, tests once per job and no `test:*` runs: followed. No `test:*` or `bun test` ran.
- Reminder, `check:job` for a product-code job: not applicable. This review commits no code.
- Reminder, a review runs no suite, lint or typecheck: followed. I only read the diff.
- Reminder, never delete `node_modules/.cache/`: followed. I deleted nothing.
