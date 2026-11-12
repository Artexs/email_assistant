# s2-telegram — Stage 23

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 23 — VPS deploy with the pilot bot [risky]

Preconditions (user checkpoint 4): stages 0–22 are committed and pushed; S1b stage 37 is done (`spec/features/done/2026-11/F025-s1b-shadow-run/plan.md` shows it ticked); the user says go. Shell on the VPS: `ssh home_vm`, `cd ~/email_assistant`, bash, `C="docker compose -f deploy/compose.yaml --env-file .env"`. Pilot ids: org `<ORG>` = `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `<MB>` = `8bc7f572-a7f5-4fa5-aaab-db16dc663e96` (`notes/2026-11-03-pilot-vps.md`). The agent never prints or edits `.env`; the user edits it.

**Risk (name it to the user before the go):** if the S1b shadow week (stage 38) runs, this deploy restarts the server in that week. A restart costs about one minute of triage, and each mail in a running LLM call gets one attempt (the 30-second batch wait and `stop_grace_period: 45s` make this rare). A crash loop of the new code would stop the triage of the week: step 23.1 watches for it, and the rollback below needs no DB change, because the S2 migration only adds tables, one column and one default.

- [x] **23.1 Deploy S2 to the VPS with the pilot bot and link the user's chat**
  - Goal: the pilot server sends the digest and the notices through the pilot bot; dev and pilot use two different bots (done-when).
  - Files: this task file ("Results", log line); `notes/2026-11-03-pilot-vps.md` (append: the S2 deploy date, the new `.env` key name `TELEGRAM_BOT_TOKEN` without its value, the pilot bot user name).
  - Interfaces: none (operations).
  - Decisions:
    - The pilot token goes only into the VPS `.env`. The two tokens are compared only by a hash prefix, never printed.
    - The link from `telegram:link` is a one-time secret for 15 minutes: the agent gives it to the user in the chat; after the first use it is worthless.
    - Rollback: `git rev-parse --short HEAD` before the update gives `<OLD>`. If the server does not start, restarts again and again, or the triage stops: `git checkout <OLD> && $C up -d --build --wait`, tell the user, and later `git checkout master`. The new tables stay; the old code does not read them.
  - Steps:
    1. `date -u`; check the preconditions; write `<OLD>` in the log.
    2. The user adds `TELEGRAM_BOT_TOKEN=<pilot token>` to the VPS `.env` (mode 600). Checks without values: VPS `grep -c '^TELEGRAM_BOT_TOKEN=.' .env` → `1`; the hash prefixes differ: Mac `grep '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2- | shasum -a 256 | cut -c1-12`, VPS the same with `sha256sum`.
    3. Update as in `deploy/README.md`: `git pull`, `$C up -d --wait db`, `$C run --build --rm server bun run db:migrate`, `$C up -d --build --wait`. `$C logs --since 5m server` shows `listening on port 8080` and `telegram: polling as @<pilot bot>` (the pilot name), and no `409`.
    4. `$C run --rm -T server bun run telegram:check` → `bot @<pilot bot>`; on the Mac `bun run telegram:check` → `bot @<dev bot>`: two different names.
    5. `$C run --rm -T server bun run digest:times --org-id <ORG> --times 08:00,16:00` → `08:00, 16:00 (Europe/Warsaw)`.
    6. `$C run --rm -T server bun run telegram:link --org-id <ORG>` → the user opens the link → `✅ This chat is linked.`; then `/status`: the pilot mailbox, `Mode: shadow`, `Last sync` at most 5 min ago, the LLM call line, the triage scope line.
    7. Watch 15 minutes: `$C logs --since 15m server | grep -E "\[(channels|telegram|reports)" ` has no `error` line; when the scope is `all`, `triage` lines still come, and the vps-shared query QC = 0.
    8. The next scheduled digest (08:00 or 16:00) arrives; the user taps ✅ on one line; `$C exec -T db psql -U postgres -d email_assistant -c "select source, count(*) from triage_feedback group by 1;"` shows a `telegram` row.
  - Test: none (operations).
  - Check: steps 3–8 give the results above.
  - Done when: the checks pass and the user confirms the digest on the phone. The labels from the pilot bot also count for S1b stage 40 (`eval --real` reads every feedback source).
  - Progress 2026-11-06 (main session): steps 1–5 and 7 done (see the task log); steps 6 (link the chat) and 8 (digest + ✅ tap) wait for the user on 2026-11-07.
  - Progress 2026-11-07: step 6 done (chat linked 2026-11-06 ~23:05Z); step 8 done (08:00 digest sent 07:00:15Z, two `telegram` ✅ rows). Stage done.
  - Out of scope: real mail of another person (ADR 0013 gate), a webhook, a change of `TRIAGE_LLM_SCOPE` (S1b decides it).
