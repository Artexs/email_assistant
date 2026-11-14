# VPS panel checks, 2026-11-14 (F069 check 3, F082 stage 15.3)

Run from the owner's machine on the tailnet, against `https://email-assistant.<tailnet>.ts.net` (home VPS runs commit `2edbfef`). Headless Chromium through Playwright; script and logs only in `/tmp/ea-checks/` (`phaseA.log`, `phase1.log`, `phaseB3.log`, `phaseB3b.log`, `phaseB3c.log`, `phase2.log`, screenshots `*.png`). Nothing was changed on the VPS except the test organization, its user and the sessions of the checks. Ids and counts only; no password, link or token is in this note.

## Set A — F069 check 3 (session IP)

- A1 PASS: after the smoke sign-in of the pilot owner (user `8fb22cd6-14f2-4ee0-9f3e-39dcf370f5b1`, sign-in status 200), the newest `auth_sessions` row has `ip_address` like `100.%` (not `172.30.%`).
- A2 PASS: rows per prefix after the check: `100.` = 5, `172.30.` = 0, other = 0 (total 5).
- A3: `docker network inspect email-assistant_default`: subnet `172.30.0.0/24`, gateway `172.30.0.1`.

## Set B — F082 stage 15.3 (steps 1–5 and 7; step 6 was proven before)

Test org `d615e7eb-f3e0-43b1-9ae8-4c906e8d64e6`, test user `8f9979f1-8707-48af-ae21-d1ca753140c5` (address `s6b-test@example.invalid`).

- B1 PASS: `org:invite --org-name 'S6b test' --email s6b-test@example.invalid --display-name Test --lang en` made org and user above and printed one link on the tailnet host (read inside the script only).
- B2 PASS: `/setup` without the terms box showed "Accept the terms to continue."; with the box and `password1234` it showed the leaked-password error; a random 24-character password signed in, landed on `/onboarding`, 0 dialogs; `users.terms_accepted_at` is set for the test user.
- B3 PASS (with a finding): the right password during the lock shows "Wrong e-mail or password." (status 401, run `phaseB3c.log`); `auth_lockouts` for the test user: `failed_count` 0, `locked_until` not null and in the future after the 10th failure (`locked_until` 11:25:08 UTC); the right password signed in at 11:25:51 UTC after the lock ended (status 200, `/onboarding`).
  - Finding (not a product failure of the lockout): the better-auth per-IP rate limit on `/sign-in/email` answers 429 "Too many attempts. Wait a minute and try again." after about 2–3 tries in 10 s. Ten fast wrong tries from one browser (`phase B3`, `phaseB3.log`) reached the server only twice, the lockout count stayed at 2, and the 11th try showed the 429 text, not "Wrong e-mail or password." A run with 6 s gaps still hit 429 twice in 8 tries (count 8; the right password then signed in and reset the count). The 10-try run with 11 s gaps (`phaseB3c.log`) made 10 failures with 401 and locked the user. A person who types 10 tries by hand is slower than 10 s per try, so the spec check holds in practice; a script needs the gaps.
- B4 SKIP: the pilot owner already accepted the terms (`users.terms_accepted_at` set for the pilot; 2 of 2 users accepted: pilot and test user). The pilot sign-in in B5 showed 0 dialogs.
- B5 PASS: Account card (`/settings`) of the pilot lists 5 sessions (DB: 5 rows for the pilot) with exactly 1 badge "This device".
- B7 PASS: `org:plan --org-id d615e7eb-f3e0-43b1-9ae8-4c906e8d64e6 --plan suspended` → plan trial → suspended; DB `organizations.plan` = `suspended`.

## Script defects (not product)

- The first Set A try signed in too early (before the React form was ready): no request, no new session row. The rerun waited for network idle; the counts above come from the rerun.
- The first log-out try looked for a "Log out" button; the button is in the "Account menu" dropdown.

## Left on the VPS

Test org `d615e7eb-f3e0-43b1-9ae8-4c906e8d64e6` (suspended; S6c deletes test organizations), its user, its sessions and the extra pilot sessions from the check sign-ins.
