# Timing summary

## Time per suite (sum of the case times, serial run)

| suite | JUnit cases | skipped | time (s) |
| --- | --- | --- | --- |
| unit | 7039 | 0 | 98.5 |
| int | 5924 | 3 | 1125.1 |

## The 20 slowest files

| file | cases | time (s) |
| --- | --- | --- |
| apps/server/test/integration/lab-bots.test.ts | 23 | 73.33 |
| apps/server/test/integration/imap-contract.test.ts | 72 | 49.77 |
| apps/server/test/integration/lab-reset.test.ts | 18 | 48.62 |
| apps/server/test/integration/actions-copy-check.test.ts | 19 | 46.35 |
| apps/server/test/integration/replies-answered-pass.test.ts | 25 | 46.11 |
| apps/server/test/integration/mailbox-cli-streams.test.ts | 31 | 44.11 |
| apps/server/test/integration/cli-streams-other.test.ts | 52 | 37.14 |
| apps/server/test/integration/mail-seed.test.ts | 13 | 25.69 |
| apps/server/test/integration/web-lockout.test.ts | 15 | 18.97 |
| apps/server/test/integration/web-two-factor.test.ts | 50 | 18.91 |
| apps/server/test/integration/mail-check.test.ts | 15 | 18.09 |
| apps/server/test/integration/testmail-cli.test.ts | 18 | 17.91 |
| apps/server/test/integration/actions-copy-baseline.test.ts | 11 | 17.83 |
| apps/docs/scripts/shots-build.test.ts | 4 | 17.47 |
| apps/server/test/integration/actions-copy-keep.test.ts | 8 | 15.89 |
| apps/server/test/integration/mail-oauth-connect.test.ts | 54 | 14.84 |
| apps/server/test/integration/mail-sync.test.ts | 102 | 14.82 |
| apps/server/test/integration/mailbox-settings-urgency-cli.test.ts | 4 | 14.77 |
| apps/server/test/integration/stats-week-cli.test.ts | 6 | 14.34 |
| apps/server/test/integration/privacy-dsr-find.test.ts | 17 | 11.72 |

## The 30 slowest cases

| time (s) | suite | file:line | name |
| --- | --- | --- | --- |
| 7.33 | int | apps/server/test/integration/mail-seed.test.ts:380 | seed exits 1 for a wrong or missing test address, and 0 with the right one; audit exits 2, then 0 |
| 6.91 | int | apps/server/test/integration/lab-bots.test.ts:610 | the fifth failed send ends the reply with skip send_failed; the next ticks stay quiet |
| 6.69 | int | apps/server/test/integration/lab-bots.test.ts:664 | a subject that decodes to a line break ends as render_failed after five tries; nothing goes out |
| 6.33 | unit | apps/docs/scripts/shots-build.test.ts:117 | an unknown page fails the build with the shots on and off |
| 6.32 | int | apps/server/test/integration/testmail-cli.test.ts:218 | 5 + 6. send sends each case once to the test address; status shows it; a repeat sends nothing |
| 6.12 | int | apps/server/test/integration/mail-check.test.ts:160 | with probe: SEARCH HEADER works, the draft is deleted, the probe mail reaches INBOX |
| 6.05 | int | apps/server/test/integration/lab-reset.test.ts:379 | 4: after the reset the demo mailbox has 0 mails in INBOX and Sent; the lab mailbox keeps its mails |
| 5.61 | int | apps/server/test/integration/testmail-cli.test.ts:241 | a TEST_MAILBOX_ADDRESS in other letter case sends to the pinned address |
| 5.16 | int | apps/server/test/integration/cli-streams-other.test.ts:213 | drop of a database that is in use: refused on stderr, exit 1 |
| 5.01 | int | apps/server/test/integration/mailbox-settings-urgency-cli.test.ts:80 | --file sets the profile and `show` prints counts; --clear prints `urgency none`; streams are right |
| 5.00 | int | apps/server/test/integration/db-role.test.ts:61 | is false within 7 s when the DB accepts the connection and never answers |
| 4.71 | int | apps/server/test/integration/mailbox-cli-streams.test.ts:601 | show, mode, sync-folder and expire-ready print to stdout; a missing mailbox fails on stderr |
| 4.63 | int | apps/server/test/integration/mailbox-settings-urgency-cli.test.ts:183 | another organization: its id with this mailbox fails and changes nothing; each org sets its own |
| 4.63 | int | apps/server/test/integration/mail-history-connect.test.ts:300 | a suspended organization, an unknown mailbox, another organization's mailbox and bad arguments exit 1 and write no row |
| 4.61 | int | apps/server/test/integration/stats-week-cli.test.ts:140 | 3. with trust_ladder on the M8 rows get one trust line per category; off, no such line |
| 4.61 | int | apps/server/test/integration/lab-reset.test.ts:353 | 3: the other lab org, its mailbox and its run are the same after a reset: every table with org_id, row for row |
| 4.58 | int | apps/server/test/integration/lab-reset.test.ts:519 | 5c: guard 3 (mailbox rows): the right name and entry address, but the org has a real mailbox |
| 4.45 | int | apps/server/test/integration/mail-seed.test.ts:343 | --folder Oferty and --eval-cases --folder Wiadomości-śmieci fill that folder; AI/Info exits 1 |
| 4.44 | int | apps/server/test/integration/web-lockout.test.ts:214 | at most 3 lockout mails per UTC day |
| 4.31 | int | apps/server/test/integration/lab-bots.test.ts:365 | 9b: the same crash, but the sim server moved the reply to Notifications → no second reply in any folder |
| 4.26 | int | apps/server/test/integration/lab-bots.test.ts:222 | 6: done sends one reply at its time, from the delegate, with the threading headers |
| 4.18 | int | apps/server/test/integration/lab-bots.test.ts:304 | late: nothing for the delegation, one done for the first reminder, nothing for the second |
| 4.15 | int | apps/server/test/integration/lab-bots.test.ts:546 | P1: a delegation with Reply-To, Cc and Bcc outside gets one reply to the run mailbox only |
| 4.03 | int | apps/server/test/integration/contacts-refresh-time.test.ts:88 | 1 committed data and fresh statistics: one pass finishes in 15 s, a repeat pass writes no row |
| 3.99 | unit | apps/docs/scripts/shots-build.test.ts:89 | DOCS_SHOTS=on with the files passes: the desktop file in the image, the phone file in a <picture> source |
| 3.97 | int | apps/server/test/integration/trust-history-classify.test.ts:377 | 500 window mails, none triaged, 0.1 s per call, a run every 15 s: done before connect + 60 min |
| 3.90 | int | apps/server/test/integration/imap-probe-send.test.ts:53 | probeSend: runs every write on GreenMail and cleans up |
| 3.80 | int | apps/server/test/integration/lab-reset.test.ts:492 | 5: the demo entry names an org called Kordelan lab: org_mismatch, nothing is deleted |
| 3.77 | int | apps/server/test/integration/actions-copy-check.test.ts:74 | 1. a reply (flag draft_copy_check off) and a delegation (flag on): one SMTP call each, result same |
| 3.75 | unit | apps/docs/scripts/shots-build.test.ts:76 | T3: DOCS_SHOTS unset passes, logs `shots: off` once and shows a box with the alt text |

## Join check

- Scan rows: 11650; unit or int rows: 11425; JUnit cases: 12963.
- `unscanned` JUnit cases: 23 (0.18 % of the JUnit cases), of which ambiguous: 0.
- `not-run` scan rows: 23 (0.20 % of the unit and int rows).
- Shared rows: 40; JUnit cases joined to them: 151 (not counted in `unscanned`).
