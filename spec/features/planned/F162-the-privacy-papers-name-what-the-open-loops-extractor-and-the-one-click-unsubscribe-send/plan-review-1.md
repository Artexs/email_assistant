FAIL 127f4fac29b812b6f53759a784dc5d0bb18cf3bb

Cold review of the F162 plan folder (`spec/features/planned/F162-…/`: ticket.md, plan.md, questions.md, stages/01–03). HEAD is 127f4fac, which matches the candidate. The code under `apps packages docs deploy` has no change between the plan base fb1df6d64 and HEAD (`git diff --stat` is empty), so the facts I checked hold at HEAD. I ran no test suite, lint or typecheck (review job rule). All the evidence below comes from reading the code.

Pre-mortem answer: stage 01 lets the user-visible bugs through. It writes a privacy sentence about retries that the code contradicts (finding 1). It leaves the DPA and two sections of the privacy and terms pages false next to the new text (findings 2, 3). Its commit order cannot pass the pre-commit hook as written (finding 4). Stage 02 drops a risk row because of a test fact that is not true (finding 5).

## Blocking findings

1. **Proven by code reading: P3 and C264 say "at most three calls" per mail, and the code does not hold that.**
   - Plan text: `plan.md:58` says "One call per mail; a failed call is tried again, at most three calls". `plan.md:66` (C264, "the three calls"). `stage-01:29` makes case 4 assert that C264 holds `three`.
   - Code: `apps/server/src/modules/loops/analyze.ts:226-231` counts an attempt only for `timeout`, hard errors and schema errors. A soft code (`http_429`, `http_500`, `http_502`, `http_503`, …; `platform/llm/errors.ts:28`) or a config code trips the pause and returns `stop`. `recordFailure` does not run, and the row keeps its attempts.
   - Effect: the next run after the pause sends the same mail again, with its full input, and nothing bounds the count. A 5xx or 429 can come after the provider got the request body. `docs/capabilities/open-loops.md` rule 2 says the same: "A soft error … other than `timeout` … counts no attempt".
   - Fix: change P3, C264 and stage-01 case 4. For example: "a call that fails because of the mail is tried at most three times; when the AI service is busy or down, the call is tried again later". Tie the test to `MAX_ATTEMPTS` and not to the word `three` alone.

2. **Proven by reading: the DPA is an in-app legal page in the same digest and version, and it stays false.**
   - `apps/web/src/legal/en/dpa.md:12-18` says "The processor processes the mail only to run these functions": triage, actions, drafts, digests, delegation follow-up.
   - The DPA does not name open loops, which already runs for the pilot. It does not name the newsletter unsubscribe or report mail.
   - P1 (`plan.md:56`) counts "six pages", but no stage edits `dpa.md` or `pl/dpa.md`. `grep -rn "dpa\|DPA" spec/features/planned/F162-*` (scouts aside) gives no match.
   - `docs/legal/records-of-processing.md:48` (record B Purposes) cites dpa.md "Nature and purpose" as its source. Stage 02 (`stage-02:57`) adds the two purposes to record B, and its source would then disagree with the DPA.
   - Fix: add a stage-01 seam for both DPA pages ("Nature and purpose": open loops, newsletters, report mail) and a ledger-row change for the DPA paper rows (C111–C135).

3. **Proven by reading: the new report-mail line (P6) conflicts with the shadow-mode sentences that stay.**
   - `apps/server/src/modules/channels/report-mail-sender.ts:96-140` checks only the flag, the channel and the chosen mailbox. It never checks the mailbox mode, so a mailbox in shadow mode still gets an APPEND into its INBOX.
   - These sentences stay unchanged:
     - privacy `en/privacy.md:28` ("A new mailbox starts in shadow mode, where the assistant changes nothing")
     - privacy `en/privacy.md:58` ("A new mailbox is in shadow mode: nothing changes in the mailbox")
     - terms `en/terms.md` § Your mailbox ("In shadow mode the assistant changes nothing in the mailbox")
     - DPIA `docs/legal/dpia.md:14` (Modes)
     - DPIA `docs/legal/dpia.md:29` (Less intrusive options)
   - `privacy.md:60` ("The assistant only sorts, flags, moves and drafts") and `privacy.md:55` ("AI and decisions", which lists what the AI does) also become incomplete. They name no extractor answer, no APPEND and no unsubscribe request.
   - P3 (`plan.md:58`) and P6 (`plan.md:61`) name only the bullets "AI model", "AI results", "Digests and notices" and "Mail provider".
   - Fix: add a decision for the shadow-mode exception and for the "AI and decisions" bullets in privacy, terms and DPIA. If the terms page changes, add a terms seam to stage 01.

4. **Plausible, high (I read the hook and did not run it): D4 cannot pass the pre-commit hook as written.**
   - D4 (`plan.md:72`) and stage-01 `:11` put the `TERMS_HISTORY` entry in "the last commit of stage 01".
   - The hook runs `bun test --changed=HEAD` (`scripts/pre-commit.sh`; `scripts/test-unit-changed.sh:6-7`: "Changed = committed … plus staged, unstaged and untracked files"), over `test:unit`, which includes `apps/web/src/lib`.
   - `apps/web/src/lib/legal-version.test.ts` imports `@ea/core/web`. That package re-exports `../legal` (`packages/core/src/web/index.ts:37`), so a change to `subprocessors.ts` or `data-categories.ts` selects the test.
   - Its test 2 then fails until the last digest matches the working tree. Any earlier commit of a `.ts` file fails while a registry edit is in the tree, even an unstaged one, and `--no-verify` is forbidden.
   - F153 shipped the entry in the same commit as the registry edits (2e3d426ad) and then re-digested it in a fix commit (fb26bc1b8).
   - Fix: state that the entry goes in with the first commit that changes a digest input, and that each later commit before the land re-digests that same unlanded entry. After `git merge master`, move it after any new master entry.

5. **Proven by reading: D7 drops a DPIA risk row because of a false test fact, and the one-click risk has no row.**
   - `plan.md:74` says "No new DPIA risk row (the test needs exactly eight)". `stage-02:52` repeats it.
   - `apps/server/src/legal-papers.test.ts:253-263` only checks that rows R1–R8 exist with levels. An R9 passes.
   - The one-click request confirms to an outside sender that the mailbox is live. The link can hold a subscriber id or the address. No risk row and no measures row covers this.
   - Fix: decide on an R9 (for example "a newsletter sender learns that the mailbox is active", mitigated by the owner tap, DKIM and the trusted auth-results, info or notification senders only, and no repeat), or give the real reason why no row is needed.

## Notes (not blocking)

6. **Proven by reading: the stage-01 break check contradicts D3.** D3 (`plan.md:70`) says "The tests use these exact strings". With literal strings, setting `EXTRACT_BODY_MAX` to 7999 (`stage-01:35`) fails only case 1, not "cases 1, 2, 4, 6". Stage 02 case 10 (`stage-02:66`) derives its string from the constant. Pick one form for stage 01: derive the en string with `toLocaleString("en-US")` and the pl string with the plain number.

7. **Proven by reading: the stage-03 break check predicts the wrong error.**
   - `stage-03:90` says that removing `C263` from the ledger makes `claim_check` report `proof_not_in_ledger` for `extractor.ts`.
   - C264's source (`plan.md:66`) also names `packages/core/src/loops/extractor.ts`, and `apps/docs/src/security/claims.ts:278` accepts any cited row.
   - So only `apps/server/src/modules/triage/prompts/extractor-v1.ts` is reported.

8. **Proven by reading: an existing test breaks and no stage names it.** `apps/docs/src/security/claims.test.ts:122-126` asserts `rows.size` is 262. Stage 01 adds C263–C266, and the stage-01 Proof (`plan.md:99`, `apps/docs/src`) fails until this number changes.
   - Plausible follow-on: stage 02 may add a row (`stage-02:58`) while stage 03 edits `claims.test.ts` (`stage-03:87`). Both would then edit that file, which contradicts "no shared file" (`plan.md:120`).

9. **Plausible: the code ties can pass when the sent fields change.**
   - Stage-01 case 1 (`stage-01:26`) pins `ONE_CLICK_BODY` but not the value of `ONE_CLICK_USER_AGENT`, the method or the headers.
   - Case 5 checks only the constant names as text.
   - Nothing pins the key set of `extractorInputOf` (`packages/core/src/loops/extractor.ts:119-130`).
   - A cheap, discriminating tie: `Object.keys(extractorInputOf(…))` toEqual `["subject","sentLocal","recipientCount","body"]`, plus a pin of the user-agent value.

10. **Plausible: the P4 wording is too absolute.**
    - `plan.md:59` says the request "holds no data of the mailbox". The request line carries the path and query that the newsletter wrote. Such links often encode the subscriber address or an id (`public-http.ts` sends the URL as given).
    - Suggested wording: "the link as the newsletter wrote it, which can identify the subscriber".
    - P4 also does not decide whether the "Transfers outside the EEA" bullet (`privacy.md:49`) or the opening line "lists each outside service that gets data" (`privacy.md:45`) changes. The newsletter server can be anywhere.

11. **Plausible gap outside the four items: the stylist call has no paper text.** `apps/server/src/modules/replies/stylist.ts` sends "the cut texts of the sent mail" (style samples) to the AI. Neither the privacy "AI model" bullet nor the `openai` `dataReceived` names it. The ticket bounds F162 to four items, so this belongs in a separate ticket if it is confirmed. The `openai` `purpose` ("sorts mail and writes drafts", `subprocessors.ts:40`) also stays incomplete after P3.

12. **Plausible: the public short-list line of the security page stays incomplete.** It names only the classified mail (`apps/docs/src/content/docs/security.mdx:25`, `pl/security.mdx:27`). Stage 03 (`stage-03:92`) excludes it. Decide whether that line names the optional extractor too.

## Facts confirmed at HEAD

- **Extractor:** `EXTRACT_BODY_MAX` 8000, `SENT_MAX_AGE_DAYS` 14, `SENT_MAX_RECIPIENTS` 10 and `EXTRACT_TEXT_MAX` 80 are at `packages/core/src/loops/extractor.ts:13-16`. The input has no header address (`:104-130`, `extractor-v1.ts:30-45`). The skip order is at `:89-102`.
- **Exports:** `MAX_ATTEMPTS = 3` is exported from the loops index. `prompts.extractor.version` is `extractor-v1`, exported by the triage index. All roles use one provider (`platform/llm/settings.ts`, no per-role provider key in `.env.example`).
- **One-click:** `ONE_CLICK_BODY` and `ONE_CLICK_USER_AGENT` are at `public-http.ts:23-24`. `OUTSIDE_CALL_CLASSES.unsubscribe_target` is at `outside-services.ts:38-45`. `unsubscribe-data` subjects are `["others"]` (`data-categories.ts:286`).
- **Report mail:** `reportMailKinds` has 4 kinds (`notices/kinds.ts:41`).
- **Papers:** the `deploy/README.md:853` line exists. The highest ledger row is C262 and the count table is at `claims.md:24-25`. The last `TERMS_HISTORY` entry is `2026-11-20`. Loop texts are cleared 90 days after close (`loops/retention.ts:20`).

## Checks run

- `git rev-parse HEAD` printed `127f4fac29b812b6f53759a784dc5d0bb18cf3bb` (match).
- `git diff --stat fb1df6d64 HEAD -- packages apps docs deploy` printed nothing (no code drift since the plan base).
- I read the code with `grep`/`sed`/`cat`, as cited above. I ran no test file. No doubt needed a run that reading could not settle; finding 4 stays plausible because I did not run the hook.

Verdict: FAIL. Blocking: findings 1–5. Notes: findings 6–12.

## Note check

- Verdict line for 127f4fac and numbered findings: proven. `/home/artek/Documents/repos/email_assistant/.limen/jobs/2026-11-20-f162-plan-review-290419c5/note.md` points to this message; the first line is `FAIL 127f4fac…` and findings 1–12 follow.
- P3/P4/P6 facts checked against the code at HEAD with file:line: not proven. Each fact cites a file and line in this message, but I got them from read-only bash calls that joined commands with `;` or pipes. That form does not count as proof.
- Each finding quotes a plan-folder file and line: not proven. The quotes are in this message. No saved file or qualifying command shows them.
- Easy-to-miss rule ("Missing code detail … is not a finding; a missing decision, edge case, test or interface is"): not proven. Each finding names a missing decision, a wrong test prediction or a conflict, and none is only about line numbers or edit text. The only evidence is this message.
- Reminder "tests run once per job; no `test:unit`/`test:int`/`test:e2e`": followed. I ran no test command in this session.
- Reminder "review job runs no test suite, lint or typecheck": followed. I ran none; I only read files and ran git commands.
- Reminder "`check:job` as the last step of a job that commits product code": not applicable. This review committed nothing.
- Reminder "never delete `node_modules/.cache/`": followed. I did not touch it.
