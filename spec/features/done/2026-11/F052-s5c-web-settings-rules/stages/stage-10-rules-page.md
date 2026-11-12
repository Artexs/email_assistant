# s5c-web-settings-rules — Stage 10

Part of [`../plan.md`](../plan.md). Read that file's "Done when", "Owns", S1–S11, "Facts checked", B1–B16, "User steps" and the master plan's "Rules for every step" (`spec/features/done/2026-11/F007-s5-web-panel/plan.md`) first.

## Stage 10 — Rules page

One step.

- [x] **10.1 `/rules`: the filter, the add form, three lists, delete (S2, S8, B14)**
  - Goal: the owner lists, adds and deletes sender rules; an assistant sees them read-only.
  - Files: change `apps/web/src/islands/RulesPage.tsx`; create `apps/web/src/components/rules/AddRuleForm.tsx`, `RuleList.tsx`, `apps/web/src/lib/rules-view.ts`, `rules-view.test.ts`.
  - Interfaces:

    ```ts
    // lib/rules-view.ts
    export const ruleKindOrder = ["vip", "whitelist", "blocklist"] as const;
    export function groupRules(rules: readonly RuleView[]): Record<SenderRuleKind, RuleView[]>; // keeps the API order inside a kind
    export function scopeLabel(
      rule: RuleView,
      mailboxes: readonly { id: string; address: string }[]
    ): { key: TextKey } | { address: string };
    export function rulesPath(mailboxId: string | null): string; // "/api/rules" or "/api/rules?mailboxId=<encoded>"

    // components/rules/AddRuleForm.tsx
    export function AddRuleForm(props: { mailboxes: MailboxView[]; onAdded(rule: RuleView): void }): JSX.Element;
    // components/rules/RuleList.tsx
    export function RuleList(props: {
      kind: SenderRuleKind;
      rules: RuleView[];
      mailboxes: MailboxView[];
      isOwner: boolean;
      onDeleted(id: string): void;
    }): JSX.Element;
    ```

  - Decisions:
    - `RulesPage`: `AppShell` (`active "rules"`, title `title_rules`) around `<Rules />`; data: `useMe()`, `useResource` for `/api/mailboxes` and for `rulesPath(filter)` with `ruleListSchema` (the filter in state; changing it restarts the resource: key the list component by the filter, as stage 8 keys by the mailbox); header with `updated_at` and `refresh` (the Mailboxes page pattern).
    - Filter (`Select`, label `rules_filter_label`): `rules_all_mailboxes` (value `all` → no query) and one item per mailbox address.
    - `AddRuleForm` (owner only; an assistant sees `set_owner_only` instead): kind `Select` (`rules_kind_label`; `rule_kind_vip`, `rule_kind_whitelist`, `rule_kind_blocklist`; default VIP), pattern `Input` (`rules_pattern_label`, `autoComplete="off"`, `rules_pattern_help` under it), scope `Select` (`rules_scope_label`; `rules_all_mailboxes` or a mailbox address), `rules_add`. Validate with `ruleBodySchema` before the request (`pattern_invalid` inline, U4; no silent fix of `@x.pl`, S8); `POST /api/rules` → 201 → toast `rule_added_toast`, clear the pattern, `onAdded` (the page reloads the list and `useMe()` for the onboarding rules count); 409 `rule_exists` → the inline `err_rule_exists` under the pattern (B14); 409 `rule_limit` → toast `err_rule_limit`; 404 → toast `err_not_found` and reload the mailboxes; 400 → the `details` keys inline.
    - `RuleList`: a `Card` per kind in `ruleKindOrder` (with `data-kind=<kind>` for the Playwright scope of stage 11) with the title `rule_kind_<kind>` and the text `rules_<kind>_text`; rows: the pattern (`break-all`, rendered as text), the scope (`rules_all_mailboxes`, the mailbox address, or `rules_scope_removed` for an id that the mailbox list lacks), and for the owner an icon button (`Trash2` from `lucide-react`, `aria-label` = `rules_delete` with `{ pattern }`) → `DELETE /api/rules/<id>` with no dialog (U5) → toast `rule_deleted_toast`, `onDeleted` (reload); 404 → toast `err_not_found` and reload. Empty kind → `rules_empty`.
    - Page states (U4): skeleton while loading; `rules_load_error` + `retry`.
    - One column, `max-w-3xl`, both widths (U3).
  - Test (unit, `rules-view.test.ts`): `groupRules` of five mixed rules → three lists in API order; `scopeLabel` for `mailboxId` null → `{ key: "rules_all_mailboxes" }`, a known id → `{ address }`, an unknown id → `{ key: "rules_scope_removed" }`; `rulesPath(null)` → `/api/rules`; `rulesPath("a b")` encodes.
  - Check: `bun run lint && bun run typecheck && bun run test:unit && cd apps/web && bun run build`; a hand check in the worktree dev server: add `boss@firma.test` (VIP, all mailboxes), `@x.pl` (inline error), `spam.test` (blocklist, the GreenMail mailbox), the same VIP again (inline "exists"), filter by the mailbox, delete both; 400 px and 1280 px; zero console or CSP errors.
  - Done when: the tests and the hand check pass; `grep -rn "\"[A-Z][a-z]" apps/web/src/components/rules/*.tsx` shows no UI literal.
  - Out of scope: Playwright (stage 11).
