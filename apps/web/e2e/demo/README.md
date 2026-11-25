# Demo script spike (F121 stage 09)

The demo video follows 8 steps (`apps/web/e2e/lib/demo/steps.ts`, `DEMO_STEPS`). This file records, for the e2e seed, which step the
recording can do **live** and which it can only show from seed state. Rules (D7): the panel, the product CLIs (`org:flag`,
`telegram:link`, `mailbox:connect`, `rules:add`, `job:run`) and GreenMail delivery only; no SQL. Source (D10): the e2e seed; a step may sign
in to the e2e organization that holds its state. The e2e servers run `TRIAGE_LLM_SCOPE=off` (`apps/web/e2e/env.ts`), `ACTIONS_SCOPE=synthetic`,
`SEND_SCOPE=self`.

"Live" means the recording performs the action and the product answers. "Seed" means the recording only shows rows that the seed wrote;
the caption then names the day.

| #   | Step id       | Live?    | E2E organization and user                                                                            | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Demo source |
| --- | ------------- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | `connect`     | live     | main seed organization, `seed.owner` (no mailbox yet)                                                | Mailboxes page, Connect dialog, GreenMail address (`connectGreenMail` in `helpers.ts`); or `mailbox:connect`.                                                                                                                                                                                                                                                                                                                                                      | open        |
| 2   | `shadow`      | **seed** | trust organization, `trustOrgs[project].owner`; `reportMailboxes.done` (mode shadow)                 | Days cannot pass in a recording. The Settings and Activity pages show the shadow mailbox. Caption: "Day 3: …".                                                                                                                                                                                                                                                                                                                                                     | open        |
| 3   | `report`      | **seed** | same trust organization; the page `/report` of the `done` mailbox                                    | The history check is a seeded row (`e2e-trust-rows.ts`). A real check needs the history job, which follows `TRIAGE_LLM_SCOPE` (off: it never claims the row). Caption: "Day 3: …".                                                                                                                                                                                                                                                                                 | open        |
| 4   | `recommended` | live     | same trust organization; flag `trust_ladder` is on in the seed (`org:flag` for another organization) | Click "Turn on recommended" on the report of the `done` mailbox (`report.spec.ts` does this tap).                                                                                                                                                                                                                                                                                                                                                                  | open        |
| 5   | `urgent`      | **seed** | needs a linked chat (`telegram:link` to the fake Telegram) and a triaged urgent mail                 | With the model off no worker triages a delivered mail, so no `urgent` row exists and `detectUrgent` (`modules/channels/notices/urgent.ts`) queues no notice. A VIP rule (`rules:add --kind vip`) changes the sender context for the classifier only; it does not triage by itself (checked in `main.ts` `triageScope` and `docs/capabilities/triage.md` rule 6). Only a seeded notice could be shown (stage 08 view `/_fake/view?chat=<id>`). Caption: "Day 5: …". | open        |
| 6   | `approval`    | live     | approvals organization, `approvalsOrgs[project].owner`; flag `approvals_page` on                     | `/approvals?id=<edit send>`: "Change", change the text, Save, wait until "Yes, send it" is on, press it, see the outcome line ("Sending to …" or "Sent to …"). The waiting send is a seed row; the edit and the approve are real (SEND_SCOPE=self admits the delegate).                                                                                                                                                                                            | open        |
| 7   | `delegation`  | live     | delegations organization, `delegationsOrgs[project].owner`; flag `delegation_pages` on               | `/delegations`: "Remind now" on the `overdue` row; or `job:run --name delegation.chaser --force`.                                                                                                                                                                                                                                                                                                                                                                  | open        |
| 8   | `undo`        | live     | activity member of the seed organization (`activityMembers`)                                         | Activity page: find the row by `li[data-email-id]`, press Undo on the moved notification, see the undo toast; the committer (synthetic scope) applies it.                                                                                                                                                                                                                                                                                                          | open        |

## Result

3 of 8 steps are not live (2, 3, 5). Rule D7 allows 2; the coordinator raised the limit to 3 for the e2e-seed video
(`spec/features/done/2026-11/F121-e10b-public-pages-and-demo/stage-09-question.md`, option 1). The `live` flags in `DEMO_STEPS` follow this table.
The e2e-seed video is never a G3 candidate (D10). Follow-up ticket F151 redoes the spike on the C1 demo seed, where the sim stack has real
triage, and must make steps 2, 3 and 5 live or say why not.

Side facts for stage 10:

- The recording signs in to four e2e organizations (main, trust, approvals, delegations), each from its own client address (the login rate
  limit counts per address). Step 8 (undo) uses the owner of the main organization, the same organization that step 1 connected the
  mailbox for; the activity rows come from `e2e-activity.ts` (`seedActivity`), run inside step 1 so the wait is not in the video.
- The sign-ins happen before the recording starts, in a context that records nothing: no sign-in form is in the video. The recording page
  takes the session of each organization from the saved cookies.
- Steps 6 and 8 change seed rows (an approved send, an undone move). `bun run demo:record` empties the demo database (`db-reset.ts`) and runs
  `db:migrate` at each run, so a second run starts clean (`demoDbProblem` guards that database).
- Step 1 leaves a connected mailbox that the server polls; the servers stop at the end of the run.
- Step 5 shows a notice that the recording renders with the product renderer (`renderNotice("urgent", …)` from a made-up view,
  `lib/demo/notice.ts`) and posts to the fake Telegram. The chat is linked to no organization: a real link would put the consent and
  welcome texts of the bot in the chat before the notice.
- The page is 1600 x 900 and the video 1280 x 720 (Playwright scales the frames): at 720 px height the connect dialog of the panel has its
  Connect button outside the page.
- Step 6 waits for the committer to make the mailbox copy of the edited version before Approve works (it runs every 15 seconds). That wait is
  part of the step; the step is never shorter than its planned `seconds`.
