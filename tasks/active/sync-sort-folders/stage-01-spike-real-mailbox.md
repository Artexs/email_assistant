# sync-sort-folders — Stage 1

Part of [`../sync-sort-folders.md`](../sync-sort-folders.md). Read that file's "Facts checked" (F1–F9), "Not verified" (NV1–NV3), D12 and "Rules for every step" first.

## Stage 1 — Spike on the real mailbox: sort-folder and spam-folder moves [risky]

Why risky: it writes to the user's only real mailbox (APPEND, COPY, EXPUNGE of 2 synthetic probe mails, and COPY out and back of one of the test tool's own
AgentMail smoke mails). Who: the main session (not an implementer).
Gate: user checkpoint 0 (a yes in chat). The reviewer (Opus, high) checks the script before the run.

- [ ] **1.1 Probe script, run on the VPS, facts into the notes**
  - Goal: check NV1–NV3 before any code depends on them: a COPY out of `Oferty` and out of `Wiadomości-śmieci` into `AI/*` stays, the COPY back stays,
    an APPEND transfer from `Wiadomości-śmieci` into INBOX stays and keeps the identity, and the STATUS UIDNEXT value.
  - Files: create `/tmp/ea-ssf-spike/spike.ts` (not in git; the scripts folder holds nothing else); bundle `/tmp/ea-ssf-spike/spike.js`. Change
    `notes/2026-11-03-interia-imap-capabilities.md` (new section "Sort-folder probe (sync-sort-folders stage 1, <date>)"), this task file § Results and Log.
  - Interfaces: the script imports from the worktree by absolute path (like `/tmp/ea-ssf-count/count.ts`, F1): `loadConfig`, `createSecretBox`, `createDb`,
    `getMailbox`, `getCredentials` (`mail/repo.ts`), `connectImapClient`, `createImapMailProvider` (`mail/imap/client.ts`), `renderSeedMessage` (`mail/seed.ts`),
    `assertTestAddress` (`mail/imap/probe-move.ts`). Build: `cd <worktree> && bun build /tmp/ea-ssf-spike/spike.ts --target bun --outfile /tmp/ea-ssf-spike/spike.js`
    (no `--env`); then `grep -c "DATABASE_URL=postgres\|CREDENTIALS_KEY=" /tmp/ea-ssf-spike/spike.js` must print 0.
    The script has two parts, each a separate run (independent review 2026-11-08, m1: `Bun.stdin.text()` reads to the end of the input, so one run cannot
    wait for a `synced` line before step E). Part 1 = steps A–D2 (the `Message-ID` of step D2 goes in on stdin, one line; the script reads it with
    `await Bun.stdin.text()`); it prints the probe `run` id. Part 2 = steps E, F, G; it gets the `run` id as an argument (8 hex characters, not secret).
    Run part 1: `scp -q /tmp/ea-ssf-spike/spike.js home_vm:/tmp/ea-ssf-spike.js && printf '%s\n' '<message-id of step D2>' | ssh home_vm 'cd ~/email_assistant && docker compose -f deploy/compose.yaml --env-file .env run --rm -T -v /tmp/ea-ssf-spike.js:/tmp/ea-ssf-spike.js:ro server bun /tmp/ea-ssf-spike.js part1; echo exit=$?'`
    (stdin passes through `ssh … run --rm -T`, notes §9). Run part 2 (the start rule is in step E):
    `ssh home_vm 'cd ~/email_assistant && docker compose -f deploy/compose.yaml --env-file .env run --rm -T -v /tmp/ea-ssf-spike.js:/tmp/ea-ssf-spike.js:ro server bun /tmp/ea-ssf-spike.js part2 <run>; code=$?; rm -f /tmp/ea-ssf-spike.js; echo exit=$code'`.
    If part 1 fails, run part 2 at once (it cleans up every probe copy and the smoke mail; its step E skips when P2 is not in `Wiadomości-śmieci`).
  - Decisions (the script, in this order; every step prints one JSON line with the step name, folder **keys**, UIDs, sizes, booleans and times; never a subject,
    an address or a body):
    1. Guard: the mailbox address must equal `process.env.TEST_MAILBOX_ADDRESS` (`assertTestAddress`), else exit 1 before any IMAP call. Pilot ids: org
       `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`.
    2. Probe mails: `run` = 8 random hex characters (part 1 makes and prints it; part 2 takes it from `process.argv`). P1 and P2 from `renderSeedMessage`: `From` `probe@ea-seed.test`, `To` the mailbox address, subject
       `EA probe ssf <run> <n>`, `Message-ID` `<ea-probe-ssf-<run>-<n>@ea-seed.test>` (the `@ea-seed.test>` suffix keeps them out of the pilot-week queries),
       short made-up body. Folder keys in the output: `inbox`, `offers` (`Oferty`), `junk` (`Wiadomości-śmieci`), `ai_info` (`AI/Info`),
       `ai_notifications` (`AI/Notifications`).
    3. Step A: APPEND P1 into `Oferty` and P2 into `Wiadomości-śmieci` (no flags, INTERNALDATE = now). Print the APPENDUIDs.
    4. Step B: wait 90 s. Locate each probe by `Message-ID` (SEARCH SINCE yesterday, FETCH envelope, compare the id) in "the locate set": INBOX, `Oferty`,
       `Społeczności`, `Rachunki`, `Wiadomości-śmieci`, `Kosz` and every `AI/*` folder that LIST shows (`AI/Info`, `AI/Spam`, `AI/Notifications`, `AI/Manual` if
       present). Expected: each only in its own folder. Print `{ step: "B", probe, foundIn: [keys] }` (keys: `ai_spam`, `ai_manual`, `trash` for the new ones).
    5. Step C: with `createImapMailProvider(client, { bodyLimitBytes: 5_000_000, forceCopyMove: true }).moveMessage`: P1 `Oferty` → `AI/Info`,
       P2 `Wiadomości-śmieci` → `AI/Notifications`. Wait 120 s. Locate as in B. Expected: only in the target (NV1, out). Print the new UIDs.
    6. Step D: move back the same way (`AI/Info` → `Oferty`, `AI/Notifications` → `Wiadomości-śmieci`). Wait 120 s. Locate. Expected: only in the source (NV1, back).
       6b. Step D2 (review M2: a mail that Interia itself sorted): pick one mail in `Oferty` whose envelope `From` is `ea-testmail-75wd@agentmail.to` and whose
       `Message-ID` has no `emails` row on the VPS (notes §10: `piotr-re-termin` or `faktura-wystawiona`; the `message_id` of each case is in the send log
       `~/.local/state/ea-testmail/2026-11-08-smoke.jsonl` on the PC; check with a read-only SQL count by that `Message-ID` before the run, and pass only the
       `Message-ID` to the script by stdin). Move it `Oferty` → `AI/Notifications` with `moveMessage`; wait 5 min;
       locate in the locate set: expected only in `AI/Notifications`. Move it back to `Oferty`; wait 5 min; expected only in `Oferty`. Print UIDs and folder keys only.
       This mail is the test tool's own (code-patterns: the test tools may move their own mail); it stays in `Oferty` after the run.
    7. Step E (part 2; the main session starts part 2 within 30 s after a `synced 8bc7f572-a7f5-4fa5-aaab-db16dc663e96` line in
       `docker compose … logs --since 6m server`, so that the 5-minute sync tick does not store P2 from INBOX): print the flags of P2 (system flags and
       keywords only, independent review m3). APPEND transfer of P2: lock `Wiadomości-śmieci`, FETCH `source`, `flags`, `internalDate`, `size` of its UID;
       APPEND the source into INBOX with the flags minus `\Recent`, `\Deleted`, `$Junk` and `Junk` (as stage 9) and the same INTERNALDATE; then `messageDelete` of the source UID.
       Wait 60 s. Locate in INBOX and `Wiadomości-śmieci`. Expected: only in INBOX; size, INTERNALDATE and `Message-ID` equal to step A (NV2).
    8. Step F (cleanup, `try/finally`). Part 1, after an error in A–D2: nothing more (the main session runs part 2 at once); after a success: delete the
       copies of P1 in the locate set, keep P2 in `Wiadomości-śmieci` for part 2, print `{ step: "F1", p1Leftovers: 0 }`. Part 2 (also after an error in E):
       delete every copy of P1 and P2 found in the locate set with `deleteMessage` (the old VPS code may have stored P2 from INBOX in step E and the
       committer may have moved it into an `AI/*` folder: the locate set covers them). Locate again: expected nowhere. Print `{ step: "F", leftovers: 0 }`.
       If the smoke mail of step D2 is not in `Oferty` (part 1 stopped half-way), locate it in the locate set and move it back into `Oferty`.
    9. Step G (part 2): `client.status(path, { uidNext: true, uidValidity: true, messages: true })` for the 5 synced folders and the UID of `*` in each (NV3).
       Also `listedExactly` for each `SYNC_FOLDER_DEFAULTS` path (stage 3 names; use the literals here): true when a `client.list()` path is equal to the
       literal (JavaScript `===`, no Unicode normalization). Discovery (D2) compares in the same way, so a false value = stop and ask (independent review m2). Print the numbers and booleans.
    10. After the run, read-only SQL on the VPS: `select count(*) from emails where message_id_header like '<ea-probe-ssf-%'` → expected 0. If 1 (the sync
        stored P2 from INBOX in step E), write it down: it is harmless (an action on it ends `mail_not_found`; the week queries exclude `@ea-seed.test>`).
  - Test: the run output (no unit test). Expected values per step above. Any other value = a finding.
  - Check: the review of the script (Opus, high) before the run; the output lines; the SQL count; `ssh home_vm 'docker compose -f ~/email_assistant/deploy/compose.yaml --env-file ~/email_assistant/.env logs --since 30m server' | grep -c ' error '` → 0 new errors.
  - Done when: steps A–G and D2 printed; step F `leftovers: 0`; `listedExactly` true for the 4 paths; the smoke mail is in `Oferty`; the facts are in the Interia note and in § Results; the main
    session wrote the checkpoint 1 result (as expected → go on; else stop and ask the user, D12) in the Log. A D2 result "sorted back" is a stop even when the
    synthetic probes stayed.
  - Out of scope: any product code; a COPY into INBOX (F8 already shows that Interia sorts it back); real mail of the user.
