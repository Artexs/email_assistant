PASS ab3b2b08588b588a1b0c1e78bf22142dd31cf49d

The demo-takes candidate does what stage 05 asks. The e2e caption of step `report` now names no first person. The new caption tests hold and fail when broken. The proof logs show a full e2e take that is marked "not for upload". Two captions are not true of what the take shows: step 7 (raised by the worker) and step 6 (not raised). The stage rule makes these questions for the coordinator, not changes, so they do not block.

Reviewed commit: `git rev-parse HEAD` = ab3b2b08588b588a1b0c1e78bf22142dd31cf49d. That is the candidate. The diff from master (85e91bfc92, still master's tip) is two commits: f1cbef1e5 (captions and tests) and ab3b2b085 (README row 2).

## Blocking findings

None.

## Unverified checks

- **`tmp/demo/demo.{en,pl}.vtt` files (test 5):** I could not read these. The worker worktree `…-f171-pebble-demo-takes-stage-05-9cb9614d` no longer exists. I did rebuild both VTT files from the `demo_step` cue lines in `/tmp/f171-05/demo.log` with this candidate's `toVtt` and `cutPlan`. Their sha256 equals the logged `caption_sha256` for en (e1aba9a4…) and pl (50b720d1…). Each has 8 cues, and the `report` cue holds the P4 text. So test 5 is proven by reproduction, not by reading the files.
- **Stills against the final take:** the 8 stills come from an earlier take. The files date from 02:42, and the panels read "Updated 02:40/02:42"; the Telegram stamp is 01:41:41 UTC. The proof take in `demo.log` ran 01:44–01:46Z. Only the README row changed between the two takes, and captions are separate VTT files, not burned into the frames. The look evidence still applies, but it is not a frame of the proof take.

## Answers to the worker's four caption questions

1. **Step 7 (delegation): the caption is false. Proven** by still 7 and the capability page.
   - The caption reads "The assistant sends the chaser." / "Asystent wysyła ponaglenie."
   - The still shows the banner "Reminder planned. Approve it to send." `docs/capabilities/delegation.md` says "A reminder is never sent without a tap" (rule 8) and "It never sends" (rule 13, Remind now, ADR 0003).
   - This breaks the PB-8 rule that a promise must be true today. The demo-source line "The assistant reminds that person." skips the approval in the same way.
   - Proposed e2e text: en "A task goes to a delegate.\nThe assistant plans the chaser for your approval." and pl "Zadanie trafia do osoby delegowanej.\nAsystent przygotowuje ponaglenie do Twojej akceptacji." The pl text uses a present tense with no gender.
   - This is a user-visible change, so it needs an owner or coordinator decision.
2. **Sidebar shows Settings on the report page:** not a caption question. Still 3 shows "Settings" highlighted on `/report`. No caption names the sidebar. Any fix belongs to the owner of the report page's navigation, not this stage.
3. **Amber notice at the end of step 4:** the caption stays true. Still 4 shows "Turned on: Notifications. The mailbox is in assist mode now." and, in the amber box, "Everything that is recommended is already on."
   - The cause is in `apps/web/src/components/report/ReportContent.tsx`: `note === "all_on"` shows once `due` is empty after the tap.
   - The warning tone right after a successful tap is a page-copy issue for the report page's owner. A follow-up ticket fits better than a caption change.
4. **Two `mail_not_found` warnings in step 8:** this is the known seed limit. The caption is true of the product, but this take does not show it.
   - `demo.log` lines 334 and 336 show `action_failed reason=mail_not_found` for org ef282264 (the main seed org). They come in the committer run right after the `web_undo` by its owner.
   - `notes/2026-11-11-web-activity-facts.md` (fact 9) predicts this. The synthetic activity mail is not in GreenMail, so the reverse move and the reverse `mark_read` fail.
   - The frame shows only "Undo started". "The mail returns to the inbox" holds with real mail (F151's demo source), but not in this e2e take. That is acceptable because this take is never uploaded.
   - The README row 8 text "the committer (synthetic scope) applies it" is wrong for this take. The same row also names `activityMembers`, but `record.spec.ts` uses `become("main")` (`seed.owner`).

## Notes

- **Step 6 caption does not match the take. Proven** by still 6 and the seed. The worker did not raise it.
  - The caption reads "A reply waits for approval." / "Odpowiedź czeka na zatwierdzenie."
  - The edited and approved card is "Delegation to Anna Nowak", subject "Fwd: E2E weekly report". `seedSend` in `apps/server/src/scripts/lib/e2e-approvals-rows.ts` defaults to `kind: "delegation"`.
  - Proposed text: en "A draft waits for approval." and pl "Szkic czeka na zatwierdzenie." The coordinator decides, as for step 7.
- **Step 2 frame weakens the story (proven by still 2, cause plausible).** The caption is "Day 3: three shadow days passed. Nothing in the mailbox changed." In the frame, the first card is the trust mailbox in "Mode: assist". The `report-done` mailbox shows "Mode: shadow", and every card reads "Not synced yet". A mailbox with three shadow days behind it would show a sync. The likely cause is the seed state. Worth a question to whoever owns the e2e trust seed.
- **Step 3 frame shows conflicting counts (proven by still 3).** The summary reads "Mails checked: 0." (`rep_checked` from `view.check.checked`). Each category card reads "Mails checked: 200". The seeded check row (`e2e-trust-rows.ts`) probably has `checked = 0`. The caption line "Every move is a plan, with its evidence." comes from P4 and is not shown at the per-move level on this page; that is the owner's P4 choice.
- **Step 5 "at once" (plausible, minor).** The notifier runs every 15 s, but quiet hours (default 22:00–07:00) hold urgent notices (`docs/capabilities/digest-and-notices.md` rule 3a). The demo-source wording "A short notice goes to Telegram" is the safer claim.
- **P4 Polish text is correct.** "Dzień 3: co zrobiłby asystent." is grammatical. The masculine `zrobiłby` agrees with "asystent", not with the reader, so PB-8 is met. The other pl captions use imperatives or present tense, with no reader gender.
  - The demo-source pl lines of shadow and report keep "co by zrobił" with an implied subject. The caption before them has "skrzynkę" as its object, so a reader may expect "zrobiła". This is not first person; it is an optional polish for F151.
- **Test 2 misses fused Polish first-person forms. Proven** with `bun -e`. The word-boundary regex `/(^|[^\p{L}])(I would|bym|I)([^\p{L}]|$)/u` matches "co bym zrobił" but not "co zrobiłbym" or "Pokazałbym, co". The stage spec says "as a word", so the test meets the letter of the spec. A suffix check `/bym(?!\p{L})/u` would cover the PB-8 intent (test name: "no first person").
- **README row 2 change is correct.** Step 2 of `record.spec.ts` goes to `/mailboxes` and waits for `en.mb_mode_shadow`.
- Step 1 (Mailboxes, "Mode: shadow"), step 4, step 5 (fake Telegram urgent notice) and step 8 (Activity, "Undo started") match their captions, apart from the points above. Panel stills 1–4 and 6–8 show the Pebble look: teal, the rounded frame and the new sidebar. Still 5 shows the fake Telegram view, as the stage expects.

## Checks run

- `git rev-parse HEAD`: ab3b2b08588b588a1b0c1e78bf22142dd31cf49d, matches the candidate. Master's tip is 85e91bfc92, the same as the `check:job` line.
- `bun install --frozen-lockfile`: OK, 991 packages. It was needed to run the one test file.
- `bun test e2e/lib/demo/steps.test.ts` (one file, in `apps/web`): 49 pass.
- Break check (test 3): I put back "Day 3: what I would have done." and ran the file again. The result was 2 fail and 47 pass: the exact-text test and "the e2e en caption of report has no first person". I then restored the file; `git status` was clean.
- `bun -e` regex probe: results as in the note on test 2.
- VTT rebuild from the `demo.log` cues with `toVtt` and `cutPlan`: both sha256 values equal the logged values, 8 cues each.
- Read the saved logs:
  - `/tmp/f171-05/check.log`: the last line is `check:job PASS master=85e91bfc92 tip=ab3b2b0858 full=0`, and `steps.test.ts` passed in it.
  - `web.log`: the build ended with "Exited with code 0".
  - `demo.log`: has `demo_source e2e`, then the 8 `demo_step <id> end` lines in `DEMO_STEPS` order, then `not_live shadow,report,urgent`. The last line is `[demo-record] not for upload: e2e_source`.
- I read all 8 stills in `/tmp/f171-05/`.
- No suite, lint or typecheck run, as the review rules require.

## Note check

- HEAD is the candidate: proven. `git rev-parse HEAD && git status --short` printed ab3b2b08588b588a1b0c1e78bf22142dd31cf49d and a clean tree.
- Report caption equals P4, and steps.test.ts has tests 1 and 2: proven. The file is `apps/web/e2e/lib/demo/steps.ts` (report e2e caption) and `apps/web/e2e/lib/demo/steps.test.ts` (`describe("captions")`). They pass in `/tmp/f171-05/check.log`.
- Test 3 (fails when broken): not proven by the Limen proof standard. I saw 2 fail and 47 pass, but I joined that bash call with `;` and saved no log. I did not rerun it, because the rule is to run once.
- Tests 4 and 5 (recording log lines, VTT cues): proven. Test 4 is shown by `/tmp/f171-05/demo.log` (`demo_step … end` ×8, `not_live shadow,report,urgent`, last line `not for upload: e2e_source`). Test 5 is reproduced from that log: the rebuilt VTT hashes equal the logged `caption_sha256`. The `tmp/demo/*.vtt` files themselves were gone.
- PROOF_OK chain: proven by the saved logs `/tmp/f171-05/check.log` (`check:job PASS master=85e91bfc92 tip=ab3b2b0858`), `/tmp/f171-05/web.log` (exit 0) and `/tmp/f171-05/demo.log`. The `PROOF_OK` echo itself is not in a saved file.
- Captions against the stills, and the four questions answered: proven. The files are `/tmp/f171-05/step-1-connect.png` … `step-8-undo.png` and `docs/capabilities/delegation.md` (rules 8 and 13). The answers are above.
- Easy-to-miss rule, "Run no test suite.": followed. I ran one test file only (for the break check), and no suite, lint or typecheck.
- Reminder "tests run once per job / no `test:unit`, `test:int`, `test:e2e`": followed.
- Reminder "a review job runs no suite, lint or typecheck; one test file only to prove a doubt or see a new test fail": followed (only `steps.test.ts`).
- Reminder "`check:job` as the last step of a product-code job": does not apply. This is a review job and it made no commit.
- Reminder "never delete `node_modules/.cache/`": followed (not touched).

## Decisions for the owner

- **User-visible:** the step 7 caption, and the step 6 caption, need new text. Proposals are above; the stage rule leaves this choice to the coordinator.
