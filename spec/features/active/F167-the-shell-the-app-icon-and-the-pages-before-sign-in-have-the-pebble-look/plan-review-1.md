FAIL 3397fb71fb5c02018e7f5f9d606c55c3b9bfd1b0

I reviewed the F167 plan for the Pebble shell, brand and pre-sign-in pages. HEAD matches the candidate `3397fb71f`. One finding blocks: the D11 login panel texts make a promise that is false for one role that sees the page. The other findings are gaps and notes. I ran no test suite, lint or typecheck, because this is a plan review. Every claim below comes from reading the files named.

## BLOCKING

**B1. The D11 panel text is false for an assistant, and the plan shows it on the assistant's first page.** Proven by reading.
- **The rule.** PB-8 (`docs/product/pebble-ui/README.md:132`) says a UI promise must be true today and agree with the claims ledger.
- **The texts.** `plan.md:23` and `questions.md:5` say: "You decide what goes out" / "Nothing is sent until you approve it". The Polish is "Ty decydujesz, co wychodzi" / "Nic nie wychodzi, dopóki tego nie zatwierdzisz".
- **The claim source.** The cited claim C047 (`docs/legal/claims.md:82`) says "an owner approves the exact text". `docs/capabilities/drafts-and-send.md:7` says "Only an owner can tap 📤 Send".
- **The roles.** `packages/core/src/tenancy.ts:3` has two roles, `owner` and `assistant`. `/login` cannot know the role, so every assistant sees the text.
- **The setup page.** `stage-04-sign-in.md:254` puts the panel on `SetupPage` "in every state". Assistants open setup links: `apps/web/e2e/tests/auth.spec.ts` "the setup link works once" uses `seed.assistants.*.setupUrl`.
- **Pre-mortem.** Stage 04 lets this through. Its Opus review checks wording, not role truth.
- **Fix.** Make both lines role-neutral. For example: en "Nothing is sent until an owner approves it." and pl "Nic nie zostanie wysłane bez zatwierdzenia właściciela." Update `questions.md` item 1 to match.

## GAP

**G1. Stage 02 tests 5 and 6 cannot hold for the account the stage names.** Proven by reading the seed comments.
- `stage-02-frame.md:177` signs in "as the main owner of the e2e seed".
- The main organization has 4 phone tabs and no `stats_page` or `delegation_pages` flag. Sources: `apps/web/e2e/tests/stats.spec.ts:8`, `delegations.spec.ts:555`, and `auth.spec.ts` "a login opens the shell" (`toHaveCount(4)`).
- With 4 tabs, `phoneOverflow` is empty. Test 6 (`:184`) then checks nothing, and its line "Stats opens /stats" fails.
- Test 5 (`:183`) lists `approvals`, `delegations`, `delegates` and `stats` "whose flag is on in the seed". Those flags are off for the main owner.
- The edge case "five tabs fit at 320 px, 99+ stays inside" (`:163`) gets no test, because test 7 runs with 4 tabs.
- **Fix.** Name the organization for each test. The approvals org (`seed-approvals.ts:37`: `approvals_page`, `stats_page`) has 5 tabs and overflow [Stats]. Without this, ticket acceptance line 27 has no proof.

**G2. The Polish wording in D11 differs from the repo's own phrasing, apart from B1.** Proven by reading.
- **Tense and referent.** "Nic nie wychodzi, dopóki tego nie zatwierdzisz" mixes a present verb with a perfective future. "tego" also points back to "nic", so the reader approves "nothing".
- **The repo pattern.** `texts/pl-approvals.ts:300` says "Nic nie zostanie wysłane przed Twoim zatwierdzeniem". `texts/pl-mailboxes.ts:84` says "nic się nie zmieni, dopóki nie ustawisz…".
- **What is consistent.** The capital "Twoja" and the word "szkice" match the other `pl` files.

**G3. The "sorted" half of D11 has no source, and the plan's own reason to reject the mockup line applies to it.** Plausible.
- `questions.md:5` rejects "Your inbox, already sorted." as "not true in shadow mode". Shadow mode is the default for every new mailbox (C015, C050), and the assistant changes nothing in the mailbox.
- "Your mail, sorted" / "Twoja poczta, uporządkowana" and "porządkuje pocztę" make the same tidy-mailbox promise. "Uporządkowana" says it even more strongly.
- C046 ("The AI sorts mail") is the nearest source, and the plan does not cite it.
- The repo already uses "sortuje" in `pl-mailboxes.ts:84`, together with the shadow-mode sentence. Pick wording C046 supports and cite C046.

**G4. The D13 cache name ignores the content of `/offline.html`.** Plausible (I read the code; I did not reproduce it).
- `plan.md:25` and `stage-05-static-pages.md:301` hash only the list of assets.
- Suppose the offline text changes and the CSS and fonts do not. Then the list, `__EA_SHELL__` and the bytes of `sw.js` all stay the same, and the browser installs no new worker.
- Users keep the old offline page until some CSS change. Today the manual `SW_VERSION` bump covers this (`apps/web/src/lib/service-worker.ts:8`); the plan removes that rule.
- **Fix.** Add the bytes of `dist/offline.html` to the hash, and add a test case for it.

**G5. Stage 05 tests 4 and 5 can pass without the precache.** Plausible.
- `cacheFirst` already writes each `/_astro/` file into the same `ea-shell-<version>` cache after `clients.claim()` (`service-worker.ts:121`, `:158-163`).
- Both layouts import the same `global.css`.
- So test 4 ("holds a .css and .woff2 path") passes from the runtime cache alone. Test 5 passes whenever the panel fetches its CSS and fonts after the worker takes control, which depends on timing.
- **Fix.** Add a break check: remove the assets from install, and test 5 must fail. Or read the cache before any request goes through the worker.

**G6. Stage 04 test 2 cannot hold as written.** Plausible (known Playwright behaviour; not run).
- `stage-04-sign-in.md:270` asks for `getByText(...)` count 0 for a panel styled `hidden lg:flex`.
- Playwright text and CSS locators also match hidden elements. Only role locators skip them. The count is 1.
- **Fix.** Use `toBeHidden()`, or a visible-only filter.

**G7. Two parallel stages edit the same line of the capability page.** Proven by reading.
- Rule 9 of `docs/capabilities/web-panel.md` is one physical line (`:59`), and the banners are described on that line.
- Stage 02 (`stage-02-frame.md:173`, "rule 9"), stage 03 (`stage-03-shell-parts.md:219`, "the line that describes the banners") and stage 04 (`stage-04-sign-in.md:265`, "rule 3 or 9") may all run together.
- Every land after the first conflicts. For stage 02 a re-prove means the full `test:e2e`.
- **Fix.** Give each stage its own rule or sub-item, for example a new shell rule that stage 02 adds. This breaks README Rules for width 1 ("own no common file") in practice.

**G8. No test checks the joined banner spacing that stages 02 and 03 build between them.** Plausible.
- Stage 03 removes the outer margins (`stage-03-shell-parts.md:205`, test 1 "no mx- or mt- class").
- Stage 02 adds the gap and the padding (`stage-02-frame.md:155`). No test of stage 02 checks it.
- The two stages run in parallel. Whichever lands second can leave master with banners flush to the screen edge, or with double spacing, and nothing fails.
- **Fix.** Add a stage 02 e2e case with the paused owner: the banner box sits inside the side padding of `main`.

**G9. The sidebar height has no rule for small desktop windows.** Plausible.
- D7 (`plan.md:19`) fixes the sticky card at "viewport height less 40 px".
- With onboarding and operator shown there are 9 items of 48 px, plus the brand, the help link and the user menu. That is about 640 px.
- A short laptop window cuts the user menu off. Decide that the list scrolls inside the card, or that the card is not fixed height.

## NOTE

- **N1. The Proof uses tools from F166 stage 08 that no Needs line names.** `plan.md:57` runs `bun run web:build:dev` and `patterns.spec.ts`. F166 stage 08 creates both (`F166 stages/stage-08-pattern-page.md:8, :24`); neither exists at HEAD. Stages 01, 03, 04 and 05 need only F166 03, and F166 runs 03 ∥ 08 (`spec/build.md:41`). In practice F166 03's own Proof B also needs `web:build:dev` (F166 `plan.md:59`), so 08 lands first. Still, write it in the Needs lines.
- **N2. Stage 03 depends on the restyled `Dialog` and `Card` primitives (F166 04 and 05), and its Needs line names only F166 03.** See `stage-03-shell-parts.md:199, :213-214`. No test breaks without them; the pictures differ until they land.
- **N3. Stage 04 restyles `LegalLinks` (`stage-04-sign-in.md:259`).** The Settings Account card (`components/settings/AccountCard.tsx`) also uses it, and the settings page ticket (F170) owns that page. That may conflict with F170.
- **N4. The safe-area padding of D9 has no effect today.** D9 (`plan.md:21`) uses `env(safe-area-inset-bottom)`. Both layouts lack `viewport-fit=cover` (`App.astro:16`, `Public.astro:25`), so the inset is always 0. Decide whether stage 01 adds `viewport-fit=cover`, since it owns the head tags.
- **N5. The ticket scope names toasts (`ticket.md:13`), and no stage covers them.** The `Toaster` primitive is F166's (`interfaces.md:63`). Either remove the word from the scope or name the toast position with the new sticky phone header.
- **N6. Stage 02 builds a second copy of the pre-sign-in card look.** The no-organization screen gets that look (`stage-02-frame.md:169`), while stage 04 defines it in parallel in `Public.astro` and `AuthCard`. The two copies can drift.
- **N7. The split frame shows a blank page before the island loads.** `split` has no brand line (`stage-04-sign-in.md:245`), and the login and setup islands are `client:only`. Today the `card` frame shows the brand line first.
- **N8. Stage 05 holds two concerns.** It does the static page look and the service worker precache rewrite in one 696-word stage. A service worker failure holds up the static pages. You could split it or mark it `[risky]`.
- **N9. Two edge cases have a rule and no check.** The reduced-motion menu sheet (`stage-02-frame.md:163`) has no test. Stage 04 test 7 (`:275`) depends on "if F166 stage 11 has landed", so what it proves varies.
- **N10. Plan facts that I checked and found true.** No `node_modules/sharp`; `@playwright/test` 1.65.0 in `@ea/web`; `#000832` in both layouts and the manifest; `PHONE_TAB_LIMIT = 5`; `displayName` is at least 1 character (`tenancy/service.ts:48`). Both `navigation` elements are named `nav_main` (`Nav.tsx:72, :134`). Every rgb value in the tests matches `interfaces.md`.
- **N11. Size is within the § Plan size limits.** `wc -w`: plan 1494, stages 605, 696, 553, 700 and 696, ticket 469.

## Needs lines

These are real interfaces: F166 03 tokens and the banner classes (F166 stage-03 `:22`), F166 06 `InitialsAvatar` (stage-06 `:17`), F166 09 `AppShell` `lead`/`action` (stage-09 `:15`), stage 01 `BrandMark`, and stage 04 `frame`. Only N1 and N2 are missing.

## Checks run

- `git rev-parse HEAD`: `3397fb71fb5c02018e7f5f9d606c55c3b9bfd1b0`.
- `wc -w` on the plan files: the counts in N11.
- Greps and file reads of the code, seed, i18n, claims and F166 stages cited above.
- No test, lint, typecheck or Playwright run (review job rule). So G4, G5 and G6 are unverified by a run.

## Note check

- **HEAD matches the candidate:** proven. `git rev-parse HEAD` printed `3397fb71fb5c02018e7f5f9d606c55c3b9bfd1b0`.
- **Every finding has a file:line and a class:** not proven. This message is the only evidence; no saved file holds it.
- **D11 Polish texts and the Needs lines are checked:** not proven. See B1, G2, G3, N1, N2 and § Needs lines; this message is the only evidence.
- **Easy-to-miss rule ("Missing code detail … is not a finding"):** followed. Each finding names a missing decision, test, edge case or interface; none asks for line numbers, edit text or file lists.
- **Reminder "tests run once per job":** followed. I ran no `test:*` command.
- **Reminder "a review job runs no test suite, lint or typecheck":** followed. I ran none.
- **Reminder "`check:job` before a product-code commit":** does not apply. This job made no commit.
- **Reminder "never delete `node_modules/.cache/`":** followed. I deleted nothing.
