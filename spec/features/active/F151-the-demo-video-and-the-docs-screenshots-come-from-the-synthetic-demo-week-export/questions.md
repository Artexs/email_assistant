# F151 questions

Defaults taken by the planner (2026-11-20). None blocks a stage. The coordinator copies the important ones to `docs/owner-decisions.md`.

## Q1 [important: user-visible] Global proof in the public video

The video shows the report and "Turn on recommended". That tap works only with a final (audited) gate file. At base `e8f6f2b1` the committed classifier gate files are `provisional: true` (owner audit pending), so the real product recommends nothing today.

- **Default (P4):** the recording copies the real gate file of the replayed model and prompt, marks the copy final so the steps run, and prints `not for upload: gate_provisional` while the real file is provisional. A video becomes an upload candidate only after the owner audit and a new take.
- Option: allow upload with a provisional file (the video then shows a recommendation that the product does not give today).
- Option: use the e2e fixture gate (decisions that no real file holds).

## Q2 [important: user-visible] The model in the public video

- **Default (P3):** a loopback replay of the demo week's own classifier answers (the real model's answers on the sim stack, C1). No spend, the same video each take. The pipeline (sync, triage, history check, notices, drafts, sends, undo) runs live.
- Option: call the real model during the recording (about cents per take, a key on the recording machine, the video can change per take; needs an owner yes for spend).

## Q3 [important: user-visible] Step 2 says "shadow mode", not "days passed"

- **Default (P2):** step 2 shows shadow decisions on mail that arrives during the recording ("it only shows what it would do"). The demo-week days are not shown as days. Reason: it is live, and no caption has to claim that time passed.
- Option: keep "Day 3:" and show the demo week's shadow days from the seed (one step not live).

## Q4 [minor] Mailbox A shows as paused

The imported mailbox stays `paused` (the import has no password). The Mailboxes page in step 1 shows it next to the new mailbox. Default: accept. Option: remove it from view (would need a product change; out of scope).

## Q5 [minor] Off-camera product settings of the demo organization

The setup turns on `user_quiet_hours` and sets no quiet hours for the owner, so a take at night still gets the urgent notice. It turns `auto` off on the imported mailbox, so the re-gate sends no `autonomy_paused` notice. It links the owner to the fake Telegram chat, so the bot's welcome texts, the trust report and the approval card are in the chat that step 5 shows. Default: accept all. Option: refuse takes between 22:00 and 07:00 Warsaw instead of the flag.
