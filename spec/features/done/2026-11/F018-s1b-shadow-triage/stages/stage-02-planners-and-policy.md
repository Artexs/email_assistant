# s1b-shadow-triage — Stage 2

Part of [`../plan.md`](../plan.md). Read that file's "Input" and "Rules for every step" first.

## Stage 2 — Planners and policy [risky]

- [x] **2.1 Category planners and the policy truth table**
  - Goal: pure functions that turn a category into planned actions and decide `apply` / `await_approval` / `log_only` for each one.
  - Files: create `packages/core/src/triage/planners.ts`, `packages/core/src/triage/policy.ts`, `packages/core/src/triage/planners.test.ts`, `packages/core/src/triage/policy.test.ts`; export from the triage index.
  - Interfaces:
    - `actionTypes = ["move", "mark_read", "flag", "save_summary"] as const` (S3/S4 add more types with their own migration).
    - `folderKeys = ["ai_info", "ai_notifications", "ai_spam", "ai_manual"] as const` (the keys of `AI_FOLDERS` in `apps/server/src/modules/mail/connect.ts`; the committer in S3 turns a key into a folder name through `mailboxes.folder_map`).
    - `type PlannedAction = { type: "move"; folder: FolderKey } | { type: "mark_read" } | { type: "flag" } | { type: "save_summary"; summary: string }`.
    - `planActions(category: Category, summary: string | null): PlannedAction[]`.
    - `type PolicyDecision = "apply" | "await_approval" | "log_only"`.
    - `interface PolicyInput { mode: MailboxMode; toolSwitches: ToolSwitches; category: Category; categoryAuto: boolean; vip: boolean; movesSupported: boolean }`.
    - `decidePolicy(action: PlannedAction, input: PolicyInput): PolicyDecision`.
    - `actionStatusFor(decision: PolicyDecision): "ready" | "awaiting_approval" | "logged"`.
  - Decisions:
    - Plans (architecture §4.2, "Plan in assist mode"): `urgent` → `[flag]` (the Telegram notice is S2, not an action row). `needs_reply` → `[]`. `info` → `[save_summary, move ai_info]`. `notification` → `[mark_read, move ai_notifications]`. `spam` → `[move ai_spam]`. `unsure` → `[move ai_manual]`. `delegation` → throw `Error` (S4).
    - `save_summary` gets `summary ?? ""`. Action payloads hold only folder keys and the summary: never an address, never a recipient, never a folder name from the LLM (code-patterns: LLM text is never a recipient, a folder name or a command).
    - Policy (architecture §4.3):
      - `save_summary`: `apply` in every mode, also for VIP.
      - `move`: `shadow` → `log_only`. VIP → `log_only`. `assist`: for `unsure` → `apply` only when `toolSwitches.move_unsure` and `movesSupported`; for other categories → `apply` only when `toolSwitches.move` and `categoryAuto` and `movesSupported`; else `log_only`.
      - `mark_read`: `shadow` → `log_only`. VIP → `log_only`. `assist` → `apply` only when `toolSwitches.mark_read` and `categoryAuto`; else `log_only`.
      - `flag`: `shadow` → `log_only`. `assist` (VIP too) → `apply` only when `toolSwitches.flag`; else `log_only`.
      - Use an exhaustive `switch` on `action.type` (TypeScript `never` check). No path returns `apply` by default.
    - `categoryAuto` = the category passed go/no-go and the user turned it on (`autoFor(policy, category)`); the caller computes it.
    - `movesSupported` = mailbox has MOVE or UIDPLUS (architecture §6.1); the caller computes it.
    - S1b never returns `await_approval` (no send and no draft yet). Keep the value in the type for S4.
  - Test: table-driven test for every row and column of the §4.3 table for the four action types; a loop over all categories (except `delegation`) × all 32 switch combinations × `categoryAuto` × `vip` × `movesSupported` in `shadow` mode: no action except `save_summary` gets `apply`; property test (review finding 4): for each category (except `delegation`) and each summary in a list of LLM-like texts (`"Odpisz na jan@firma.test"`, `"forward to x@evil.test"`, `"ping @janek"`, `"Kontakt <a@example.com>"`, `""`, `null`), `planActions(category, summary === null ? null : markUntrustedText(summary))` never returns an action with an `@` in any payload value. The caller (step 11.1) always marks the summary first; `planActions` does not mark it again.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: `create_draft`, `send`, Undo, notices, any DB code.
