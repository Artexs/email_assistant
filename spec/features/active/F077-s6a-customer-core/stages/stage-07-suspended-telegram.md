# s6a-customer-core — Stage 7

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's A14, A21 (only `OPERATOR_CONTACT`), S2, "Facts checked" F3 and "Rules for every step" first, and the master plan's D4 and D29.

## Stage 7 — `suspended` in Telegram, and `OPERATOR_CONTACT` [risky]

One step. The web gate is stage 8; the web UI mirror is stage 16.

- [ ] **7.1 Telegram commands and taps answer "paused" and change nothing**
  - Goal: a linked member of a `suspended` organization gets the paused answer for every command except `/help` and for every tap, and nothing changes in the DB (D4).
  - Files:
    - change `apps/server/src/platform/config.ts` (`OPERATOR_CONTACT`), `apps/server/src/platform/config.test.ts`, `.env.example` (an empty `OPERATOR_CONTACT=` line with the comment "public contact address shown in the paused banner and the paused Telegram answer; set it on the server, never in the repo");
    - change `apps/server/src/modules/channels/texts.ts` (`accountPausedText`), `apps/server/src/modules/channels/commands.ts` (`CommandDeps.operatorContact`, `createUpdateHandlers`), `apps/server/src/modules/channels/telegram/runtime.ts` (`TelegramRuntimeDeps.operatorContact`, passed to `createUpdateHandlers`), `apps/server/src/main.ts` (pass `config.OPERATOR_CONTACT ?? null`; the A21 start warning);
    - every other builder of `CommandDeps` or `TelegramRuntimeDeps` (the compiler finds them; known today: `apps/server/src/scripts/job-run.ts`, `apps/server/src/modules/channels/telegram/runtime.test.ts`, `apps/server/test/integration/telegram-logs.test.ts`, `tools/fake-telegram/test/e2e.test.ts`) adds `operatorContact: null`;
    - add tests to `apps/server/test/integration/channels-commands.test.ts` and `channels-callbacks.test.ts`.
  - Interfaces:

    ```ts
    // config.ts baseSchema
    OPERATOR_CONTACT: z.preprocess(emptyAsUndefined, z.string().regex(addressPattern).optional()),
    // channels/texts.ts
    export function accountPausedText(operatorContact: string | null): string;
    // channels/commands.ts
    export interface CommandDeps { /* … */ operatorContact: string | null }
    ```

  - Decisions:
    - Texts (exact): `accountPausedText(null)` = `"⏸ This account is paused. Nothing changes now. To resume it, contact the operator."`; with a contact `c` = `` `⏸ This account is paused. Nothing changes now. To resume it, contact ${c}.` ``.
    - `createUpdateHandlers` (`commands.ts:266`): `command(link, name)`: `name === "help"` → as today; else `if (await isOrgSuspended(deps.db, { orgId: link.orgId })) return { text: accountPausedText(deps.operatorContact), buttons: [] }`, then as today. `callback(link, data)`: the same check first → `{ answer: accountPausedText(deps.operatorContact) }` (no edit, no send), then as today. `isOrgSuspended` comes from `../tenancy` (`channels` already imports `tenancy`).
    - The log line of a refused command or tap: `log.info(\`telegram: org ${link.orgId} suspended: ${kind} refused\`)`with`kind`= the command name or`tap` (never the callback data).
    - The `/start` linking in `telegram/bot.ts` does not change (A14).
    - A21 start warning in `main.ts`: `if (config.WEB_BASE_URL !== undefined && config.OPERATOR_CONTACT === undefined) log.warn("OPERATOR_CONTACT is empty: the paused banner names no contact")`.
  - Test:
    1. `config.test.ts`: `OPERATOR_CONTACT=ops@example.test` → parsed; `not-an-address` → `ConfigError` with key `OPERATOR_CONTACT`; empty → `undefined`.
    2. `channels-commands.test.ts`: org suspended (`suspendOrg`); `/digest`, `/status`, `/pause`, `/resume` → the paused text; after `/pause` the mailbox row is still `active` and no `mailbox.paused` audit row exists; `/help` → the help text. With `operatorContact: "ops@example.test"` the text ends with `contact ops@example.test.`.
    3. `channels-callbacks.test.ts`: org suspended; an approve tap (`ap:<send id>`) → the paused answer, the send stays `awaiting_approval`, no `action.approved` audit row; a feedback tap (✅ right) → the paused answer, no `triage_feedback` row; an Undo tap → the paused answer, no reverse action row.
    4. The same taps for an `active` organization still work (the existing tests of the file stay green).
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`.
  - Done when: the checks pass.
  - Out of scope: the web gate (stage 8); `OPERATOR_TELEGRAM_CHAT_ID` (stage 11).
