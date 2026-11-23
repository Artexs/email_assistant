# F169 stage 07 — The sentence form for a sender rule

Part of [`../plan.md`](../plan.md). Needs stage 06: `rules-form.spec.ts` and the "Add a rule" section of `sender-rules.mdx`. Needs F166 stage 03 (tokens) and stage 10 (`SectionCard`). May run next to 01–05 and 08–10.

Mockup: the `.builder` card of screen `rules`. PB-5: the same API call, checks and errors as today.

## Step 1 — The sentence parser

- **Files:** `apps/web/src/lib/rule-sentence.ts` and its test.
- **Interface:**
  ```ts
  export type RuleSlot = "pattern" | "kind" | "scope";
  export type SentencePart = { kind: "text"; text: string } | { kind: "slot"; slot: RuleSlot };
  export function sentenceParts(template: string): SentencePart[];   // throws when a slot is missing, repeated or unknown
  ```
- **Decisions:** D16. Slots `{pattern}`, `{kind}`, `{scope}`. Text parts keep their spaces; empty ones are dropped.
- **Texts (fixed; next to `rules_add` in `texts/en-settings.ts` and `pl-settings.ts`):**

  | Key | en | pl |
  | --- | --- | --- |
  | `rules_sentence` | `Always treat {pattern} as {kind} {scope}` | `Nadawcę {pattern} traktuj {scope} zawsze jako {kind}` |
  | `rules_sentence_kind_vip` | `a VIP` | `VIP` |
  | `rules_sentence_kind_whitelist` | `trusted` | `zaufanego` |
  | `rules_sentence_kind_blocklist` | `blocked` | `zablokowanego` |
  | `rules_sentence_scope_all` | `in all mailboxes` | `we wszystkich skrzynkach` |
  | `rules_sentence_scope_one` | `in {address}` | `w skrzynce {address}` |

  The Polish order (pattern, scope, kind) differs from the English one (pattern, kind, scope); ticket acceptance 5. Native wording: `../questions.md` Q2.
- **Test:**
  1. `sentenceParts` of the en text gives the slot order pattern, kind, scope; of the pl text, pattern, scope, kind.
  2. Both texts start with a text part and hold each slot once.
  3. `sentenceParts("Treat {pattern} as {kind}")` throws (no scope); `"{pattern} {pattern} {kind} {scope}"` throws (repeat); `"{who} {pattern} {kind} {scope}"` throws (unknown).

## Step 2 — The form

- **Files:** `components/rules/AddRuleForm.tsx`.
- **Decisions:**
  - A `SectionCard` (icon `Plus`, title `rules_add_title`) that keeps `data-card="add-rule"`. Inside, a `form` named `rules_add_title` renders the parts of `t("rules_sentence")` in order: a text part as plain text in `text-lg` bold, a slot as its control. Then the Add button (`rules_add`, `default` variant, full width below `sm`).
  - Slots: the pattern `Input#rule-pattern` (`aria-label` `rules_pattern_label`, placeholder `rules_pattern_help`), the kind `Select#rule-kind` (`aria-label` `rules_kind_label`; items and trigger show `rules_sentence_kind_*`), the scope `Select#rule-scope` (`aria-label` `rules_scope_label`; items show `rules_sentence_scope_all` or `rules_sentence_scope_one` with the address). Each slot is 48 px high with the selected-slot look of the mockup (soft tint, primary edge).
  - The help line `rules_pattern_help` and the error line (`role="alert"`, `#rule-pattern-error`) stay under the sentence and stay in `aria-describedby` of the pattern field, as today. `aria-invalid` stays.
  - Below `sm` each slot takes the full width; text parts wrap between them.
  - Every outcome of today stays: `ruleBodySchema` check first, `rule_exists` inline, 404 toast and `onMissingMailbox`, 400 inline, the rest a toast; the pattern clears after a success; the scope falls back to all mailboxes when its mailbox left.
  - Delete a key only when nothing reads it after `check:job` merged master: count `apps/web` and `apps/docs` (the docs page reads keys through `UiText`, for example `rules_scope_label`). `rules_all_mailboxes` goes in whichever of stages 07 and 08 lands second.
- **Test:**
  4. A unit render test: in `en` the three controls follow in the DOM order pattern, kind, scope; in `pl`, pattern, scope, kind; each control has its accessible name from the label key.
  5. `rules-form.spec.ts` keeps its steps and locators (the labels, `data-card="add-rule"`, `role="alert"`, the toast). Only the two combobox texts change: `rules_sentence_kind_vip`, `rules_sentence_scope_all` (stage 06 step 2).
  6. The same spec, `test.use({ locale: "pl-PL" })`: add a VIP rule for `pl-${random}@example.com`; the toast shows `pl.rule_added_toast`; the a11y scan passes.
  7. Mobile project, en and pl: `scrollWidth <= innerWidth`.
  8. `suggestions.spec.ts` still finds the pattern field by `rules_pattern_label` and its half-typed text survives an Accept.

## Docs

The "Add a rule" section of `sender-rules.mdx` (en, pl) describes the sentence. `docs/capabilities/web-panel.md` rule 9, the Rules part: the form is one sentence in both languages.

## Out of scope

The rule lists and remove (stage 08); the API; a new rule kind.

## Done when

Tests 1–8 pass; you opened the sheet pictures of `rules` in en and pl; Proof B with `rules-form.spec.ts suggestions.spec.ts` prints `PROOF_OK`.
