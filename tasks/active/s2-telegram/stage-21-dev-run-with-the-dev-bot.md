# s2-telegram — Stage 21

Part of [`../s2-telegram.md`](../s2-telegram.md). Read that file's "Input" and "Rules for every step" first.

## Stage 21 — Dev run with the dev bot (user checkpoint 3) [risky]

- [x] **21.1 The user tries S2 on the Mac with the dev bot and GreenMail**
  - Goal: the done-when items work end to end on a real phone with the dev bot, before anything goes to the VPS.
  - Files: this task file ("Results": the measured times and the check results, no mail data, no chat id, no token; one log line).
  - Interfaces: none (operations). Dev DB shell: `D="docker compose -f deploy/compose.yaml -f deploy/compose.dev.yaml --env-file .env"`; SQL with `$D exec -T db psql -U postgres -d email_assistant -c "<SQL>"`.
  - Decisions:
    - The main session runs the commands; the user uses the phone and reports what they see. The agent never prints `.env`.
    - Only synthetic mail goes to the LLM (`TRIAGE_LLM_SCOPE=synthetic`, set on the command line for this run, not in `.env`): a few free-tier calls.
    - The dev org and the GreenMail mailbox from the S1b dev runs are used (find them with `select o.id, mb.id, mb.address from organizations o join mailboxes mb on mb.org_id = o.id;`). If there is none: `bun run org:create …` and `bun run mailbox:connect` against GreenMail (`deploy/README.md`, `notes/2026-11-03-greenmail-facts.md`).
  - Steps:
    1. `bun run dev:up && bun run db:migrate`. `bun run digest:times --org-id <org> --times <HH:MM local, now + 6 min>,16:00`. The slot must be later than the link of step 3 (slots before the link never count): if the link comes later, run `digest:times` again with a later time.
    2. Start the server in its own terminal: `TRIAGE_LLM_SCOPE=synthetic bun run dev`. The log has `telegram: polling as @<dev bot>` and `triage takes only synthetic mail`.
    3. `bun run telegram:link --org-id <org>`; the user opens the link on the phone and taps Start → `✅ This chat is linked.` Then `/help` and `/status` (mode `shadow`, `Last sync`, `LLM calls since …`, `Next digest`).
    4. Urgent timing: write the time `t0` (UTC); `TEST_MAILBOX_ADDRESS=<GreenMail address> bun run mailbox:seed --org-id <org> --mailbox-id <mb> --eval-cases synthetic --per-category 1` (about 5 mails, one of them an urgent case). Write the time `t1` when the urgent notice shows on the phone. Check: `t1 − t0 ≤ 10 min`.
    5. Tap ✅ on the urgent notice → the toast `✅ Saved: Urgent is right.`; SQL: `select verdict, true_category, source from triage_feedback order by created_at desc limit 1;` → `right`, `urgent`, `telegram`.
    6. `/digest` → the digest with lines, `🧪 test` marks and ✅ / ✏️ buttons; tap ✏️ on one line → the picker → pick another category → the picker message changes to `✏️ Saved: …`; SQL shows a `wrong` row with that true category.
    7. Wait for the scheduled digest at the time of step 1 → it arrives within one minute of that time; its header has the time; `Last sync` is there.
    8. `/pause` → `⏸ Paused: …`; `/status` shows `paused since`; `/resume` → `▶️ Resumed: …`.
    9. `auth_error`: SQL `update mailboxes set status = 'auth_error', status_changed_at = now() where id = '<mb>';` → within 30 s the notice `❌ Login to … failed at …` (if the local time is 22:00–07:00 it waits until 07:00: then check the `outbox` row instead). Then `printf '%s' anything | bun run mailbox:password --org-id <org> --mailbox-id <mb>` (GreenMail accepts any password) → `status active`; `/status` shows `active`.
    10. Optional (the user decides, about 45 min): `docker stop email-assistant-greenmail-1`; after 30 min without a good sync → `⚠️ Mail sync is late`; `docker start email-assistant-greenmail-1` → `✅ Mail sync works again`.
    11. Stop the server with Ctrl+C → it ends within 15 s. Check the terminal output: no subject, no address of a seeded mail, no link token, no bot token.
    12. Optional: a second Telegram account sends `/status` to the dev bot → no reply (the tests already prove it).
  - Test: none (operations). The automated tests of stages 14 and 20 cover the unlinked chat and the token cases.
  - Check: steps 3–9 and 11 give the results above; the times `t0`, `t1` and the LLM call count of the run (Q4-style SQL: `select reason_code, count(*) from audit_log where event = 'llm.call' and created_at > '<t0>' group by 1;`) are in "Results".
  - Done when: the user confirms steps 3–9 on the phone and the checks pass.
  - Out of scope: the VPS (stage 23); real mail (the dev run uses synthetic mail only).
