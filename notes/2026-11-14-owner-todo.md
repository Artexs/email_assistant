# Owner to-do, 2026-11-14

What waits for you, in the order I suggest. Each item says what to do and what to tell the coordinator after it. Time is a guess.

## Today

### 1. Rotate the OpenAI key — 10 min · security
Why: on 2026-11-13 the key appeared in a local Limen job log (a reviewer grepped `.env`). It went nowhere else, but the log stays on disk.
1. platform.openai.com → API keys → create a new key in the same project.
2. Put it in `OPENAI_API_KEY=` in the local `.env` and in `~/email_assistant/.env` on the VPS (`ssh home_vm`).
3. Tell the coordinator "OpenAI key rotated". It restarts the server and runs `bun run llm:check` on the VPS.
4. After the check passes: revoke the old key on the same page.

### 2. Panel password and two secret files — 10 min · security (from the S5e open checks, F074)
1. Open the panel, Settings → Account card → change the password. Then "Sign out everywhere" and sign in again.
2. On this PC: `rm ~/.cache/ea-smoke.pw` (it holds your current password in plain text; it still exists).
3. On the VPS: `rm ~/email_assistant/.env.bak-s5e` (a copy of every secret; it still exists).
4. Tell the coordinator "F074 hardening done". The new sign-in also closes the open check of the network ticket (F069), which needs one panel sign-in.

### 3. Polish help texts for mail providers — 5 min · user-visible
The worker translated menu names it could not verify (`apps/web/src/i18n/pl.ts` lines 140–148). Check the three that name menus:
- Onet: "Ustawienia poczty → Konto główne"
- iCloud: "Logowanie i bezpieczeństwo → Hasła dla aplikacji"
- WP and o2: "hasło dla programów pocztowych"
Tell the coordinator "help texts ok" or the right names.

### 4. Phone delegation round trip — 45 min · closes E1, which every Stage 2 ticket waits for
Between 07:00 and 21:00. You and the coordinator at the same time; tell it "start U1". You do the mail and the taps; it does the VPS reads.
1. From your Gmail, send the task mail to the pilot address (the coordinator gives the exact subject and text).
2. On the phone: read the approval message, tap 📤 Send. Check that Gmail got it (not in spam).
3. Reply "Zrobione." from Gmail; tap ✅ Done when the phone shows "answered".
4. A second task mail tests the reminder; a third one you reject with ✖️ Reject.
5. Answer two questions: how many wrong drafts did you see in the S4 pilot week, and any injection incidents (a draft with a recipient or text you did not expect)? Keep `SEND_SCOPE=all` and the one test delegate: yes or no?
Full runbook: `spec/features/active/F095-e1-close-the-mvp/stages/stage-10-delegation-round-trip.md`.

## Decisions to read — when you have 20 min

### 5. The decision log — 22 entries, all `new`
`docs/owner-decisions.md`. Write `ok` or `changed` at the end of each heading; under a `changed` entry, write what you want. Read these first: RLS is built on the default yes; your vision text changed; the Polish words and the Telegram consent text; the send limits are always on; two VPS updates overnight.

### 6. End the `plan-refresh` Limen rule — yes or no
It repeats a rule that is already on the board. I recommend yes: I end it, and the coordinator drops "until Sat 21 Nov" from its board line.

## Later — the coordinator tells you when

| Step | When | What to do |
|---|---|---|
| Grow the VPS disk | Before the live lab (E2b) and alerts (E8b) | On the VPS: `sudo lvextend -r -l +100%FREE /dev/ubuntu-vg/ubuntu-lv` (3 GB free now; +23 GB). |
| OpenAI budget alert | After E3a (F100) stage 07 lands | Steps in `deploy/README.md` § "LLM provider budget". |
| OpenAI Europe project | When the private model ticket (E11b) is planned | Create a project with region Europe; request Zero Data Retention or Modified Abuse Monitoring (PD-111). |
| One Microsoft 365 seat | Before mailbox OAuth (E9a) | Buy one Business Basic seat for the test tenant. |
| S6b login checks in a browser | Any panel session | Invite link, terms box, leaked password, 10 wrong passwords, session list (F082 stage 15.3). The coordinator guides you. |
| Five executive conversations | Your call, optional | PD-007. Questions: mail provider, daily volume, what they fear to miss, who handles their inbox. |
