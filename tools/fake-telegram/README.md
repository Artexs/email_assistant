# fake-telegram

A local fake of the Telegram Bot API, with a driver. An agent plays the Telegram user and drives full bot flows alone.

## What it is

- A Bun HTTP server on `127.0.0.1` that keeps chats and messages in memory.
- It answers the Bot API methods that the bot uses: `getMe`, `deleteWebhook`, `setMyCommands`, `getUpdates` (long polling), `sendMessage`, `editMessageText`, `answerCallbackQuery`.
- It checks the Telegram limits and gives the Bot API errors that our code handles (see "Bot API errors").
- A driver (CLI and TypeScript API) sends text and commands as the user, presses inline buttons, reads a chat and waits for a bot message.

## What it is not

- Not Telegram. It does not check how messages look in the real app.
- No webhooks, media, groups, payments or other API methods.
- No real rate limits. A 429 happens only when a test asks for it (`failNext`).
- No real accounts, no real token. The default token is not a secret.
- It has no log. It never prints a token that it did not make itself.

## Start

```sh
bun run fake-tg serve            # default port 8090
bun run fake-tg serve --port 8091
```

The command prints these lines and runs until you press Ctrl-C (SIGINT or SIGTERM):

```text
fake Telegram on http://127.0.0.1:8090 (bot @fake_ea_bot, id 1000001)
TELEGRAM_API_ROOT=http://127.0.0.1:8090
TELEGRAM_BOT_TOKEN=1000001:fake-telegram-token-local-tests-only
```

- The server binds only `127.0.0.1`.
- The token line appears only when the token is the default one (`FAKE_TOKEN`). Set another token with `FAKE_TG_TOKEN` (or `FAKE_TOKEN`) in the env of `serve`.
- If the port is busy, `serve` prints an error and exits with code 1.

## Point the dev server at the fake

Set two keys in the env of the dev server (and of the `telegram:*` scripts):

```sh
TELEGRAM_API_ROOT=http://127.0.0.1:8090 \
TELEGRAM_BOT_TOKEN=1000001:fake-telegram-token-local-tests-only \
bun run dev
```

- Always write `127.0.0.1`, not `localhost`. The fake binds only `127.0.0.1`.
- The config accepts only a loopback host (`127.0.0.1`, `::1`, `localhost`). The value has no path and no trailing `/`. Any other value stops the server at start.
- The log of the dev server must show `telegram: polling as @fake_ea_bot`.
- Use the same two keys for `bun run telegram:link --org-id <id>` and `bun run telegram:check`.
- Link the test chat: run `telegram:link`, take the token from the printed `t.me` link, then:

```sh
bun run fake-tg send "/start <token>"
bun run fake-tg wait "This chat is linked"
```

## CLI

Run: `bun run fake-tg <command> [options]`.

The examples below show the real output of the live run of 2026-11-07. Long texts are cut with `…`. Ids and times change in each run.

| Command                                                                                   | What it does                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `serve [--port <n>]`                                                                      | Starts the fake (see "Start").                               |
| `send <text> [--chat <id>]`                                                               | Sends a text or command as the user.                         |
| `press (--button <text> \| --data <data>) [--message <id>] [--chat <id>] [--timeout <s>]` | Presses an inline button and waits for the bot to answer it. |
| `read [--chat <id>] [--last <n>]`                                                         | Prints the messages of a chat, oldest first.                 |
| `wait <regex> [--chat <id>] [--timeout <s>] [--after <messageId>]`                        | Waits for a bot message that matches the regex.              |

Global options (not for `serve`): `--url <base>` (default `http://127.0.0.1:8090`, or the env key `FAKE_TG_URL`) and `--json` (one JSON line per command, no text).

Defaults: chat `5550001`; `press` timeout 10 s; `wait` timeout 30 s.

### send

```sh
$ bun run fake-tg send /digest
sent #2 (update 2)
```

### press

Without `--message`, `press` takes the newest bot message that has the button. `--button` matches the exact button text. `--data` matches the `callback_data`.

```sh
$ bun run fake-tg press --button "↩️ 1"
pressed "↩️ 1" on #5
answer: ↩️ Undo started: the mail goes back within a minute.
```

`press` waits until the bot calls `answerCallbackQuery`. The `answer` line shows the answer text (can be empty).

### read

```sh
$ bun run fake-tg read --last 2
#4 user 20:26:41 UTC
/digest

#5 bot 20:26:42 UTC
📬 Digest now … NEEDS ACTION · 1 … → done: flag
  [✅ 1 => …] [✏️ 1 => …] [↩️ 1 => …]
```

Each message shows: `#<id> <user|bot> <time UTC>`, then the edit count (if any), the text, and one line per button row with `[text => data]`. `read` of a chat with no message fails with exit code 1 (`no such chat`).

### wait

```sh
$ bun run fake-tg wait "Urgent mail" --timeout 600 --after 7
#3 bot 20:25:30 UTC
🔴 Urgent mail · 🧪 test … → will flag
  [✅ Right => …] [✏️ Change => …]
```

- The regex has the `s` flag (a dot matches a newline). It matches only bot messages.
- `--after <id>` ignores bot messages with an id up to `<id>`. Use it to skip old notices.
- Timeout is in seconds (can have decimals).

### Exit codes

| Code | Meaning                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------- |
| 0    | Success.                                                                                           |
| 1    | The command failed: timeout, no such button or chat, a bad request, or `serve` cannot start.       |
| 2    | Usage error: bad option, missing argument, bad number or bad regex. The usage text goes to stderr. |
| 3    | The fake is not reachable at the URL.                                                              |

Errors go to stderr as `fake-tg: <message>`.

## TypeScript API

The package is `@ea/fake-telegram`. It exports everything from `src/index.ts`.

```ts
import { createFakeTelegramClient, FAKE_TOKEN, startFakeTelegram } from "../src"; // from tools/fake-telegram/test

const fake = startFakeTelegram(); // port 0 = a free port; options: { port, token, bot }
const client = createFakeTelegramClient(fake.apiRoot);
// ... start the bot with apiRoot: fake.apiRoot and token: FAKE_TOKEN ...

await client.send("/start abc");
const notice = await client.waitFor(/This chat is linked/, { timeoutMs: 10_000 });
await client.press({ button: "↩️ 1" });
const messages = await client.read(); // FakeMessage[], oldest first

fake.failNext("sendMessage", { code: 429, retryAfter: 3 }); // next call fails once
fake.failNext("getUpdates", { code: 409 }, 2); // next 2 calls fail
await fake.stop();
```

- `startFakeTelegram(opts?)` returns `{ apiRoot, port, token, state, failNext, stop }`. `apiRoot` is `http://127.0.0.1:<port>` with no trailing `/`.
- `failNext(method, fault, times = 1)`: the next `times` calls of `method` fail with a 409 or a 429 (`retryAfter` in seconds). After that, calls work again.
- `state` is the in-memory state (`sendAsUser`, `botSend`, `messages`, `commands`, and more). Use it to prepare a chat in a test.
- The client methods are `health`, `send`, `press`, `read`, `waitFor`. They throw `FakeTelegramTimeout`, `FakeTelegramUnreachable` or `FakeTelegramRequestError`.
- Constants: `FAKE_TOKEN`, `DEFAULT_BOT`, `DEFAULT_CHAT_ID` (`5550001`), `DEFAULT_PORT` (`8090`).
- The chat exists after the first user message. Before that, `sendMessage` fails with "chat not found" (as in Telegram).

## Bot API errors

The error shape is `{ ok: false, error_code, description }`, with the HTTP status equal to `error_code`.

| Case                                                      | Code | Description                                                    |
| --------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| Wrong token in the path                                   | 401  | `Unauthorized`                                                 |
| Unknown method or path                                    | 404  | `Not Found`                                                    |
| `sendMessage` or edit to a chat with no user message      | 400  | `Bad Request: chat not found`                                  |
| Text empty or only spaces                                 | 400  | `Bad Request: message text is empty`                           |
| Text longer than 4096 characters                          | 400  | `Bad Request: message is too long`                             |
| `callback_data` empty or longer than 64 bytes             | 400  | `Bad Request: BUTTON_DATA_INVALID`                             |
| Edit of a message that does not exist                     | 400  | `Bad Request: message to edit not found`                       |
| Edit with the same text and the same buttons              | 400  | `Bad Request: message is not modified: ...`                    |
| Second `answerCallbackQuery` for one id, or an unknown id | 400  | `Bad Request: query is too old ...`                            |
| Second `getUpdates` while another one waits               | 409  | `Conflict: terminated by other getUpdates request...`          |
| `failNext(..., { code: 429, retryAfter })`                | 429  | `Too Many Requests: retry after <n>`, `parameters.retry_after` |

- Only "message is not modified" is read by the app. The other texts are close to Telegram, but not verified.
- `getUpdates` waits at most 8 seconds, then answers `[]`. This is valid Bot API behaviour.

## End-to-end test

`test/e2e.test.ts` runs the real Telegram runtime of the server against the fake, the dev DB and GreenMail: link the chat, urgent notice, `/digest`, undo button, then checks the DB and the mailbox flags.

```sh
bun run dev:up      # Postgres and GreenMail
bun run db:migrate
bun run test:int    # runs apps/server/test and tools/fake-telegram/test
```

- The test uses a transaction that it rolls back, and a new GreenMail user for each run.
- `bun run test:unit` runs only `tools/fake-telegram/src` (the fake's own tests). It needs no DB.
- Do not run `test:int` while another session uses the same dev DB, GreenMail and ports.

## Live run without the shared dev DB

Use an own database when another session runs `test:int` on the shared dev DB. The dev server then does not touch the shared data. The live run of 2026-11-07 used this setup.

Prerequisites:

- `bun run dev:up` runs Postgres and GreenMail. GreenMail has auth off: the first login of a new user creates the mailbox. The IMAP password of every user is `greenmail-test`.
- The real LLM and its key come from `.env` (do not change them). The run makes about 1 classifier call.
- `<GreenMail user>` (`GM_USER`) is a new address such as `u-<uuid>@localhost`.

Steps:

1. Run `bun run db:worktree <name>`. The name has lower-case letters, digits, `_` and `-` (`-` becomes `_`). The script does these steps:
   - It creates `email_assistant_<name>` as `postgres` (password `POSTGRES_PASSWORD` from `.env`).
   - It marks the database with the comment `db:worktree`. It refuses a database that it did not create.
   - It gives the grants of `db/roles.sql` to `migrator` and `app`. These roles belong to the cluster and exist already.
   - It runs `db:migrate`.
   - It prints `DATABASE_URL=…` and `MIGRATOR_DATABASE_URL=…` for the own database.

   If the script stops between `CREATE DATABASE` and `COMMENT ON DATABASE`, the database has no mark. The script then refuses it. Drop it by hand as `postgres`.

   Manual steps (what the script does):

```sql
CREATE DATABASE email_assistant_<name>;
COMMENT ON DATABASE email_assistant_<name> IS 'db:worktree'; -- the mark: the script reuses and drops only marked databases
GRANT CONNECT ON DATABASE email_assistant_<name> TO migrator, app;
-- connect to email_assistant_<name>, then:
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO migrator;
GRANT USAGE ON SCHEMA public TO app;
```

2. The script ran the migrations. After a new migration, run `bun run db:worktree <name>` again. It reuses the database.
3. Start the server on another port, without `--watch`: `bun apps/server/src/main.ts`. Override these env keys (they win over `.env`):
   - `DATABASE_URL` and `MIGRATOR_DATABASE_URL`: the two lines that the script printed
   - `PORT`: for example `8081`
   - `TELEGRAM_API_ROOT=http://127.0.0.1:8090` and `TELEGRAM_BOT_TOKEN=<FAKE_TOKEN>`
   - `TRIAGE_LLM_SCOPE=synthetic` and `ACTIONS_SCOPE=synthetic`
   - `TEST_MAILBOX_ADDRESS=<the GreenMail user>`
4. Create the org and the mailbox with the same override env:
   - `bun run org:create --org-name <name> --email <valid address> --display-name <name>`
   - `printf '%s' greenmail-test | bun run mailbox:connect --org-id <org> --address <GM_USER> --imap-host 127.0.0.1 --imap-port 3143 --smtp-host 127.0.0.1 --smtp-port 3025` (the password comes only from stdin)
   - `bun run mailbox:settings mode --org-id <org> --mailbox-id <mailbox> --mode assist`
5. Link the chat: `telegram:link`, then `fake-tg send "/start <token>"`.
6. Seed one urgent mail: `GM_USER=<GreenMail user> bun tools/fake-telegram/scripts/seed-urgent.ts`. It prints the subject and the Message-ID. Then `fake-tg wait "Urgent mail" --timeout 600`.
7. Send `/digest`, then `fake-tg press --button "↩️ 1"` (read the real button text with `fake-tg read`).
8. Check the result: `DATABASE_URL=<the own database> GM_USER=<GreenMail user> bun tools/fake-telegram/scripts/check-undo.ts`. It prints the `actions` rows, the `triage_feedback` count per source and the INBOX flags of each mail. Exit code 0 means: the original action is `undone`, a reverse action is `applied`, an `undo` feedback row exists and no mail has `\Flagged`.
9. At the end: stop the server, then the fake. Run `telegram:unlink`. Then run `bun run db:worktree <name> --drop`. It fails while a server or a test still uses the database.

Rules and timing:

- The user e-mail of `org:create` must be a valid address. A value such as `u-<uuid>@localhost` is refused ("Invalid email address").
- The mailbox address can be the GreenMail user (`u-<uuid>@localhost`). It is not the user e-mail.
- The urgent notice came about 100 s after the seed. The sync interval causes the wait. Use `--timeout 600` for `wait`.

## Border rule

- App code (`apps/*`, `packages/*`) never imports from `tools/`. The server image holds only `tools/fake-telegram/package.json`.
- Files in `tools/fake-telegram/` may import from `apps/server/src/` and `apps/server/test/integration/` with relative paths (tool → app only).
