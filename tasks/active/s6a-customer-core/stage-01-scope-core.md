# s6a-customer-core — Stage 1

Part of [`../s6a-customer-core.md`](../s6a-customer-core.md). Read that file's "Done when", "Differences found at collect", "Facts checked", A1–A30 and "Rules for every step" first, and the master plan's D1 and D2 (`tasks/active/s6-pre-sale.md`). Decisions named D<n> are in the master plan, A<n> and S<n> in the segment file.

## Stage 1 — Scope types without the address: `scope.ts`, triage scope, config, all call sites, tests follow [risky]

Database of the build: the worktree database (segment rule). No migration in this stage.

- [ ] **1.1 `all` means every mailbox (D1, A1, A2)**
  - Goal: `TRIAGE_LLM_SCOPE=all`, `ACTIONS_SCOPE=all` and `SEND_SCOPE=all` act on every mailbox that the other gates admit, and the server starts without `TEST_MAILBOX_ADDRESS`. Nothing in the server reads `TEST_MAILBOX_ADDRESS` for a scope.
  - Files:
    - change `apps/server/src/modules/actions/scope.ts` (types and the two filter functions), `apps/server/src/modules/actions/scope.test.ts`;
    - change the call sites: `apps/server/src/modules/actions/committer.ts:321-322`, `apps/server/src/modules/actions/undo.ts:45`, `apps/server/src/modules/channels/commands.ts:161,166`, `apps/server/src/modules/channels/callbacks.ts:346`, `apps/server/src/modules/triage/jobs.ts:25,46,67`, `apps/server/src/composition.ts:13-41`, `apps/server/src/main.ts:34-45`;
    - change `apps/server/src/platform/config.ts` (lines 116-121 comments, 184-189 and 200-202 checks), `apps/server/src/platform/config.test.ts`;
    - change `.env.example` (the comments above `TRIAGE_LLM_SCOPE`, `ACTIONS_SCOPE`, `SEND_SCOPE`, `TEST_MAILBOX_ADDRESS`);
    - change the tests that build `{ kind: "all", mailboxAddress }` (the compiler finds them; today: `apps/server/test/integration/{actions-committer,actions-drafts,actions-end-to-end,actions-send,actions-undo,channels-callbacks,channels-commands,triage-job,triage-logs,triage-returned}.test.ts`, `apps/server/src/modules/mail/views.test.ts` (below)).
  - Interfaces:

    ```ts
    // actions/scope.ts
    export type ActionsScope = { kind: "off" } | { kind: "synthetic" } | { kind: "all" };
    export type SendScope = { kind: "off" } | { kind: "self"; addresses: string[] } | { kind: "all" };
    export function claimFilterFor(scope: ActionsScope): MailboxClaimFilter; // off → none, synthetic → synthetic, all → all
    export function sendFilterFor(scope: SendScope): SendClaimFilter; // off → none, self → self (lower-case list), all → all
    // scopeAdmits and sendScopeAdmits: unchanged.

    // triage/jobs.ts
    export type TriageScope = { kind: "synthetic" } | { kind: "all" };
    ```

    `composition.ts` `actionsScope(config)` returns `{ kind: "all" }` for `all`; `sendScope(config)` returns `{ kind: "all" }` for `all`; `main.ts` `triageScope` returns `{ kind: "all" }`.
    The field `mailboxAddress` in the undo mail row (`mail/repo.ts:760,773`) stays if another reader uses it; if `undo.ts:45` was its only reader, remove it from the select and the type (grep `mailboxAddress` in `apps/server/src`).

  - Decisions:
    - `triage/jobs.ts`: remove `scopeAddress` (line 46) and the address skip (line 67). The `synthetic` scope still passes `syntheticOnly: true` to `claimEmails`.
    - The start lines (A4 wording is stage 3; here only the server log): `main.ts` `all` → `log.warn(\`triage sends the real mail of every active mailbox to ${providerLabel} (TRIAGE_LLM_SCOPE=all)\`)`; `composition.ts` `all`→`"actions committer applies mailbox changes to the real mail of every active mailbox, by its mode (ACTIONS_SCOPE=all)"`and`"sends go to real recipients after an owner's tap (SEND_SCOPE=all)"`.
    - Config: delete the three `TEST_MAILBOX_ADDRESS` issues. Keep the key in `baseSchema` (optional) and in `testmailConfigSchema`. The new comments: `// off = no triage worker; synthetic = only synthetic mail; all = real mail of every active mailbox of an organization that is not suspended (S6a).`; `// off = no mailbox change; synthetic = only synthetic mail; all = real mail, by the mode and the switches of each mailbox.`; `// off = no send; self = only to SEND_TEST_ADDRESSES; all = real recipients, always after an owner's tap.` `.env.example` says the same in its own words and keeps the line "synthetic is not a security boundary".
    - Existing tests that prove the old rule ("another address acts like off") change to the new rule, with the same fixtures:
      - `actions-committer.test.ts:200` "scope all: the test mailbox gets everything, another address acts like off" → "scope all: every mailbox gets its mailbox changes": `other`'s `flag` is `applied`, and `opener.calls` holds both addresses (order of `listSyncTargets`: `created_at`, `id`).
      - `triage-job.test.ts:180` "scope all: only the mailbox with the scope address (any case) is triaged" → "scope all: every active mailbox is triaged": two prompts, both mails `triaged`.
      - Every other test only drops the `mailboxAddress` field. When a test used the address to keep a second mailbox out, it now uses `pauseOtherMailboxes` (already in most) or pauses that mailbox with `setMailboxStatus`; it must not lose its assertion.
    - `views.test.ts` (`apps/server/src/modules/mail/views.test.ts:13,18,26,38`) builds `{ kind: "all", mailboxAddress }` and compares the badges with `claimFilterFor(scope, address)`. Until stage 3 the badges still give `off/other_mailbox` for `all`, so in this stage remove the `all` entries from its two scope lists, with the comment `// stage 3 (S6a) adds the all entries back with the new badge reasons`. Stage 3 test 3 restores them.
    - `scope.test.ts`: delete the tests "all matches the test mailbox address in any case" and "all gives no mailbox change in another mailbox" (both blocks); add the tests below.
    - Do not touch `modules/mail/tools.ts`, `modules/mail/imap/probe-*.ts`, `modules/testmail/**`, `scripts/{testmail*,mailbox-probe-*,mailbox-seed}.ts`: they keep `TEST_MAILBOX_ADDRESS` (D1). `web.ts:78` (`scopeEnvOf`) is stage 3.
  - Test:
    1. `scope.test.ts` "all gives `all` for every mailbox": `claimFilterFor({ kind: "all" })` → `{ kind: "all" }`; `sendFilterFor({ kind: "all" })` → `{ kind: "all" }`.
    2. `scope.test.ts`: the existing off, synthetic, self, `scopeAdmits`, `sendScopeAdmits` tests stay green unchanged except the signature.
    3. `config.test.ts` "all scopes start without TEST_MAILBOX_ADDRESS": `loadConfig` with `TRIAGE_LLM_SCOPE=all`, `ACTIONS_SCOPE=all`, `SEND_SCOPE=all`, the provider key, no `TEST_MAILBOX_ADDRESS` → no error. Delete or invert the old tests that expect the `TEST_MAILBOX_ADDRESS` issue (grep `needed when .* is all`).
    4. `actions-committer.test.ts` (changed test above): both mailboxes get their changes.
    5. `triage-job.test.ts` (changed test above): both mailboxes are triaged.
    6. The full unit and integration suites stay green.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && bun run test:int`; then `grep -rn "TEST_MAILBOX_ADDRESS\|mailboxAddress" apps/server/src --include=*.ts | grep -v "\.test\.ts"` — expected only in `platform/config.ts`, `modules/mail/tools.ts`, `modules/mail/imap/probe-move.ts` (and its send twin), `modules/testmail/**`, `scripts/*` test tools, `web.ts:78` (stage 3), and `mail/repo.ts` only if 1.1 kept the field for another reader. Paste the output in the log line.
  - Done when: the checks pass; the grep shows no scope reader of `TEST_MAILBOX_ADDRESS`; the two changed tests prove the new rule.
  - Out of scope: the badges and texts of the web and `/status` (stage 3); the start count line and the `suspended` gate (stage 6); docs (stage 17).
