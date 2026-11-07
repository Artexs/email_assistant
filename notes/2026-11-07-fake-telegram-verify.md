# Fake Telegram: two-sided verification (2026-11-07)

Result: PASS for checks 1-5 and 7. Check 6 recorded below. Base: `origin/master` fa60c7b. Own DB made with `db:worktree ftv`, dropped at the end.

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `bun run test:unit`, `bun test tools/fake-telegram/test` | PASS | 1125 pass, 0 fail; e2e 3 pass, 0 fail |
| 2 | Server on PORT=8081 with `TELEGRAM_API_ROOT=http://127.0.0.1:8090` | PASS | log: `telegram: polling as @fake_ea_bot (id 1000001)` |
| 3 | User to bot: `fake-tg send "/start <token>"`, `fake-tg wait "This chat is linked"` | PASS | bot message #2 `✅ This chat is linked. Digests and urgent notices come here.` |
| 4 | Bot to user: `seed-urgent.ts`, `fake-tg wait "Urgent mail" --timeout 600` | PASS | notice with `[✅ Right]` `[✏️ Change]` buttons, exit 0 |
| 5 | `/digest`, `fake-tg press --button "↩️ 1"`, `check-undo.ts` | PASS | `answer: ↩️ Undo started…`; action `undone`, reverse `applied`, undo feedback 1, no `\Flagged`; `OK: undo done`, exit 0 |
| 6 | `fake-tg send hi --chat -1001234` | Works at the fake level | exit 0, `read --chat -1001234` shows the message; the app did not reply (it only knows the linked private chat). No crash in the server. |
| 7 | Cleanup | PASS | ports 8090 and 8081 closed; DB dropped |

Notes:
- The urgent notice and the undo took about 100 s each (sync interval).
- Quiet hours were active (23:32 CET); the org timezone was set to `Etc/GMT-12`.
- `telegram:unlink` needs `--org-id` and `--user-id` (not only `--org-id`). I skipped it; the DB was dropped instead.
- `db:worktree <name> --drop` refuses ("is a base database") when `DATABASE_URL` in the env already points to that DB. Run it in a clean shell.
- `pkill -f` with a pattern that is in your own command line kills your shell. Use the PID.
