# F118 checkpoint A — a real push on the owner's phone

Part of [plan.md](plan.md). Owner steps O1 to O3 of [questions.md](questions.md). Stage 06 does not start before this passes (gate G-A).

What you test: the build with stages 01 to 05 (push crypto and VAPID, device table, device API, installable panel, device card). The only sender in this build is the button "Send a test notice". The real routing of notices comes in stages 06 to 08.

Time: about 20 minutes. You need: the VPS shell, the Android phone with Chrome, Tailscale on the phone.

## Before you start

- The VPS must reach `fcm.googleapis.com` on port 443 (Android Chrome sends through Google). Check on the VPS: `curl -sS -o /dev/null -w '%{http_code}\n' https://fcm.googleapis.com/` (any HTTP code, such as `404`, is fine; a timeout is not).
- Turn on `web_push` for your own organization only. Do not turn it on for another organization (Q12: the papers name the push services only in stage 13).

## Steps

1. **Make the keys** (on the VPS or a machine you trust; no agent reads or prints them):
   `bun run push:keys`
   It prints three bare lines: `VAPID_PUBLIC_KEY=...`, `VAPID_PRIVATE_KEY=...`, `VAPID_SUBJECT=mailto:<your address>`. Keep a copy in your password manager. A new pair later ends every subscribed phone.
2. **Put them in the VPS `.env`** (the `server` and the `cli` containers read it):
   - Back up first: `cp -p .env .env.bak-f118a`.
   - Paste the three lines as they are (no prefix, no quotes). Replace `<your address>` in the subject with your real address.
   - Check that the lines exist, without printing them: `grep -c '^VAPID_' .env` prints `3`.
3. **Deploy** the release that holds stages 01 to 05 (tag it first, `docs/release-checklist.md`):
   `deploy/release.sh v<x.y.z>`
   Expect the last line `release ok <tag> previous <old>`. Then check the server started with the keys: `$C logs server | grep -iE 'vapid|config'` must show no error line. (`$C` is `docker compose -f deploy/compose.yaml --env-file .env`.) A bad key stops the server at start with a message that names the key, not its value.
4. **Turn the flag on** for your organization:
   - `$C run --rm cli bun run org:status` (find your `<org id>`).
   - `$C run --rm cli bun run org:flag --org-id <org id> --flag web_push --on`
   - Check: `$C run --rm cli bun run org:flag --org-id <org id>` shows `web_push on`.
5. **Install the panel on the phone** (Tailscale on). Open `https://<machine>.<tailnet>.ts.net` in Chrome, sign in. Tap the Chrome menu (three dots) → "Install app" (or "Add to Home screen" → "Install"). Open the panel from the new icon on the home screen.
6. **Turn on notices:** in the installed panel open Settings → the card "Phone notices". Tap "Turn on notices on this device". Android asks "Allow notifications?": tap Allow. Expect the toast "Notices are on for this device." and a row "Chrome on Android" with the mark "This device".
   - If the card is missing: the flag is off for your organization (step 4), or the page is cached: pull to refresh once.
   - If the card says "Phone notices are not set up on this server": the server has no keys (step 2 or 3).
   - If it says "Notices are blocked in the browser settings": Chrome site settings → Notifications → allow for the panel, then reload.
7. **Send the test:** lock the phone. Open the panel on another device (or before locking), tap "Send a test notice".
   Expect, **within 30 seconds**, a notice on the locked phone. Tap it: the panel opens.
   The notice has the title "Test notice" (Polish: "Powiadomienie testowe") and the text "Notices work on this device." It holds no mail text. You can send at most 5 a hour (the text "Too many test notices. Try again in an hour." shows after that).

## Pass and fail

- **Pass:** the notice shows on the locked phone within 30 s and its tap opens the panel. Tell the coordinator "checkpoint A passed". Stage 06 may start.
- **Fail:** stop F118 and report (gate G-A). Send the coordinator what you saw: the toast or text on the card, the phone model and Chrome version, and the server lines of the last minutes: `$C logs --since 5m server | grep -E 'push_|channels'`. The logs hold ids and codes only, never an endpoint or a key. The fallback is a WebCrypto push library in a new stage 01b (the owner decides).

## Roll back

Any step can stop here with no harm to mail, Telegram or other organizations.

1. Flag off (stops the card and every route; no deploy needed):
   `$C run --rm cli bun run org:flag --org-id <org id> --flag web_push --off`
2. Remove the phone device: Settings → "Phone notices" → "Remove" (before the flag goes off), or sign out on the phone (a sign-out ends the device). Android: long-press the panel icon → uninstall. Chrome site settings → Notifications → block, if you want the phone clean.
3. Remove the keys: restore the backup (`cp -p .env.bak-f118a .env`) or delete the three `VAPID_*` lines, then `$C up -d --wait server`. Delete the backup copy when you are done: `rm .env.bak-f118a` (it holds every secret).
4. Roll back the release only if the server itself misbehaves: `deploy/rollback.sh` (never rolls back the database; the new tables are harmless to the old build). Last line: `rollback ok <target>`.
