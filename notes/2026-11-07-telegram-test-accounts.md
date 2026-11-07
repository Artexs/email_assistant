# Telegram test environment and test accounts (recon, 2026-11-07)

Goal: an agent-run Telegram "tester" (a user account driven over MTProto) that talks to our bot, so the agent can run Telegram checks without the user and the phone.
Status: recon only. No plan, no code yet. Next step: user decisions (end of this note), then `tasks/planned/telegram-test-driver.md`.

## Facts (each with source and date)

### The test environment exists and is separate
- Telegram runs test DCs (3 of them). Accounts, bots, chats and data are separate from production. Telegram wipes test data from time to time, with no schedule.
  — https://core.telegram.org/api/auth#test-accounts, https://core.telegram.org/bots/webapps ("Using bots in the test environment"), read 2026-11-07.
- Test DC IP addresses show in the API development tools panel at https://my.telegram.org after you get an `api_id`. Seen in code: DC1 `149.154.175.10`, DC2 `149.154.167.40`, DC3 `149.154.175.117` (port 443 or 80). — Telethon docs, gotd `dcs/test.go`.
- Flood limits are not lower in the test environment; sometimes they are stricter. — pvavrt blog citing Telegram, 2026-10-29.

### The free 99966XYYYY accounts do NOT work any more
- The docs still say: phone `99966XYYYY`, code = X five times (X = 1..3). This text is out of date.
- tdlib maintainer levlam, 2025-06-23 (tdlib/td#3370): "Test accounts are disabled currently."
- levlam, 2026-01-17 (tdlib/td#3564): "The test accounts are disabled, because all of them where automatically registered and improperly used. ... It makes no sense to reenable them for general usage, but App Store reviewers should be able to log in". Only App Store reviewers can still use them.
- gotd `telegram/dcs/test.go` (2026): "the test DCs no longer auto-provision accounts for randomly generated 99966X test phone numbers ... sign in fails with PHONE_CODE_INVALID. A real, pre-registered test account is required".
- Blog posts from 2026-10 (pvavrt, tgway) say the numbers work. They only repeat the docs; ignore them.

### How to get a test-DC user account now
- Register with a **real phone number** (the SMS goes to it) in an official app in test mode:
  - iOS: tap the Settings icon 10 times > Accounts > Login to another account > Test.
  - Telegram Desktop: Settings > Shift + Alt + right-click "Add Account" > "Test Server".
  - macOS app: click Settings 10 times (Debug Menu), Cmd + click "Add Account".
  — https://core.telegram.org/bots/webapps.
- levlam (2025-06-23): registration works from the official iOS app; Play Store Android cannot use the test DC; "other apps can't be used to register a new account". Not verified: if Telegram Desktop can do the sign-up step (production Desktop sign-up is often refused). Try Desktop first (installed here: `telegram-desktop-bin 7.3.1-1`), use iOS if Desktop refuses.
- The user's own number is OK: a test-DC account is a different account from the production one on the same number.
- After registration, a new login (for example our MTProto tester) gets its code **inside the already logged-in test app**, not by SMS (levlam, 2025-06-23). So the user copies one code once; then the tester keeps a session string and logs in without a code.

### Bot in the test environment
- Create a new bot with @BotFather **from the test account**. Its token works only in the test environment.
- Bot API calls use `https://api.telegram.org/bot<token>/test/METHOD`. — core.telegram.org/bots/webapps.
- grammY supports it: `new Bot(token, { client: { environment: "test" } })` (`ApiClientOptions.environment: "prod" | "test"`). — https://grammy.dev/ref/core/apiclientoptions.
- The tester can create the bot itself: it chats with @BotFather over MTProto (`/newbot`, name, username) and reads the token from the reply.

### MTProto library for the tester (TypeScript, Bun)
- mtcute: TS, options `testMode` / `defaultDcs` for test DCs, string sessions (`exportSession` / `importSession`). Bun projects use it (BuddyTG, telegram-grep, 2026). Known Bun problem: mtcute's SQLite session storage fails under Bun; use memory storage + a session string (imadtg/tgsm commit f55aa53, 2026-03-30). One Linux report: direct TCP reset during the auth-key handshake; WebSocket transport fixed it (BuddyTG README).
- GramJS (`telegram` npm) has `testServers: true`; Bun support not checked.
- The tester needs `messages.getBotCallbackAnswer` to press inline buttons and update events / `getHistory` to read bot replies. Both are normal MTProto user methods.

### What the tester needs that only the user can give
1. `api_id` + `api_hash` from https://my.telegram.org (log in with the user's real number, code in the production app). One `api_id` per number. Secret: `.env` only.
2. Registration of the test-DC account (a real SMS code to the user's phone), see above.
3. One login code for the tester session (shown in the test app on Desktop/iOS).
After these ~15 minutes, the agent can do everything else alone: session string, test bot via @BotFather, sending messages, pressing buttons, reading replies.

## Options compared
- A. Test DC (recommended): no risk to the user's real account or chats; separate test bot; data can vanish (the tester must re-create bot/chat when it finds them gone; the session can also vanish → one new code from the user).
- B. Production, MTProto session on the user's real account: no extra setup, but the agent gets access to all private chats, and automation on a main account risks limits or a ban. Not recommended.
- C. Production, second real SIM: cleanest prod check, costs a SIM, the same ban risk for an automated new account.
- The existing fake Bot API transformer tests (`notes/2026-11-06-telegram-bot-facts.md`) stay for unit tests; the tester is for live end-to-end runs only.

## Open questions for the user
- iPhone available (fallback if Desktop sign-up fails)?
- OK to use their own number for the test-DC account and `api_id`?
- Where the session string lives (`.env` key, for example `TELEGRAM_TEST_SESSION`), and that the tester runs only from dev, never on the pilot VPS.

## Probe results (2026-11-07, scratch probe `~/scratch/tg-probe/`, mtcute 0.32.7, Bun 1.4.4, Linux)
- PASS: connect to the test DC with the user's `api_id` over plain TCP, no RSA key needed (`help.getConfig` → `testMode=true thisDc=2`).
- BLOCKED: `auth.sendCode` for the user's real number → `type=app next=none timeout=0`. The number already has a test-DC account with a live session on an unknown device. No SMS fallback for a third-party `api_id`.
- macOS app (13.2): "click Settings 10 times" opened nothing for the user. Same report: tdesktop#27662 (2024), no fix.
- Telegram Web A: the source (`SettingsHeader.tsx`, `SettingsExperimental.tsx`) has Settings title × 5 clicks → Experimental → "Login on Test Server". The user did not see it in Web A 12.0.48.
- Android Play Store app: no test DC (levlam, 2025).
- Assessment: the test environment is niche, badly documented, and access paths differ per app. Recommendation to the user: stop this route; use a local fake Telegram (Bot API emulator driven by the agent) for autonomous runs, and a dedicated prepaid SIM on production only if real-Telegram checks become necessary.
