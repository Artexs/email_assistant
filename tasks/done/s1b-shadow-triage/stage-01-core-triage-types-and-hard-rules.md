# s1b-shadow-triage — Stage 1

Part of [`../s1b-shadow-triage.md`](../s1b-shadow-triage.md). Read that file's "Input" and "Rules for every step" first.

## Stage 1 — Core triage types and hard rules

- [x] **1.1 Categories, settings schemas, analysis schema**
  - Goal: shared Zod types for categories, mailbox settings JSON and the LLM output.
  - Files: create `packages/core/src/triage/categories.ts`, `packages/core/src/triage/settings.ts`, `packages/core/src/triage/analysis.ts`, `packages/core/src/triage/index.ts`, tests `packages/core/src/triage/settings.test.ts`, `packages/core/src/triage/analysis.test.ts`; change `packages/core/src/index.ts` (add `export * from "./triage";`).
  - Interfaces:
    - `categories = ["urgent", "needs_reply", "delegation", "info", "notification", "spam", "unsure"] as const`; `type Category`; `categorySchema = z.enum(categories)`.
    - `classifierCategories: readonly Category[] = ["urgent", "needs_reply", "info", "notification", "spam"]` (the list the LLM may pick in S1b).
    - `mailboxModes = ["shadow", "assist"] as const`; `type MailboxMode`.
    - `reasonCodes = ["deadline_today", "direct_request", "question", "meeting_request", "automated_system", "newsletter", "marketing", "phishing_or_scam", "fyi", "other"] as const`; `type ReasonCode`.
    - `ruleReasonCodes = ["blocklist", "triage_error", "llm_blocked"] as const`: the `triage_results.reason_code` of a row without an LLM answer (`llm_blocked` = Google blocked the response for safety, user answer Q28).
    - `feedbackSources = ["cli", "telegram", "undo", "imap_move", "web"] as const`; `type FeedbackSource` (the same list as the `triage_feedback.source` check in step 3.1; used in steps 7.1 and 26.1).
    - `BELOW_THRESHOLD_REASON = "below_threshold"`: used only as the `reason_code` of the `email.triaged` audit row when the threshold turned the category into `unsure`. `triage_results.reason_code` keeps the model's code (review finding 13).
    - `toolSwitchesSchema`: `z.object({ move, mark_read, flag, create_draft, move_unsure })`, each `z.boolean().default(false)`. `type ToolSwitches`. `parseToolSwitches(json: unknown): ToolSwitches` (`{}` gives all `false`; a bad value throws).
    - `categoryPolicySchema`: `z.record(z.string(), z.object({ auto: z.boolean().default(false), threshold: z.number().min(0).max(1).default(DEFAULT_THRESHOLD) }).partial())`. `DEFAULT_THRESHOLD = 0.7`. `type CategoryPolicy`. `parseCategoryPolicy(json: unknown)`, `thresholdFor(policy, category): number`, `autoFor(policy, category): boolean` (missing = `false`).
    - `buildTriageAnalysisSchema(allowed: readonly Category[])` returns `z.object({ category: z.enum(allowed), confidence: z.number().min(0).max(1), reason_code: z.enum(reasonCodes), reason: z.string().max(300), summary: z.string().max(600).nullable(), fields: z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), language: z.enum(["pl", "en", "other"]) }) })`. `type TriageAnalysis` (category typed as `Category`).
  - Decisions: one category per mail (architecture §4.2). `delegation` exists in the type but the LLM does not get it until S4 (no delegates list yet). `unsure` never comes from the LLM: it comes from the threshold or from 3 hard errors. The confidence threshold is per category, start value 0.7, stored in `mailbox_settings.category_policy` (architecture §4.2). The `tool_switches` and `category_policy` columns default to `{}` (S1a migration): `{}` must parse to "all off". `unsure` has no go/no-go bar; only the `move_unsure` switch controls its move.
  - Test: `feedbackSources` has exactly the 5 values above; `{}` parses to all switches off; an unknown key in `tool_switches` is dropped; `thresholdFor({}, "info")` = 0.7; a policy value 1.5 throws; the analysis schema built from a list without `spam` rejects `category: "spam"`; it rejects confidence 1.2 and a bad `due_date`.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass and `@ea/core` exports the names above.
  - Out of scope: the DB, the LLM call, planners.

- [x] **1.2 Hard sender rules**
  - Goal: a pure function that applies whitelist, blocklist and VIP before the AI.
  - Files: create `packages/core/src/triage/rules.ts`, `packages/core/src/triage/rules.test.ts`; export from `packages/core/src/triage/index.ts`.
  - Interfaces:
    - `senderRuleKinds = ["whitelist", "blocklist", "vip"] as const`; `interface SenderRule { pattern: string; kind: SenderRuleKind }`.
    - `matchSender(fromAddress: string | null, rules: readonly SenderRule[]): { whitelisted: boolean; blocklisted: boolean; vip: boolean }`.
    - `isNoreplyAddress(fromAddress: string | null): boolean`.
    - `type HardRuleResult = { kind: "spam"; reasonCode: "blocklist" } | { kind: "classify"; allowed: Category[]; vip: boolean; whitelisted: boolean; noreply: boolean }`.
    - `applyHardRules(fromAddress: string | null, rules: readonly SenderRule[]): HardRuleResult`.
  - Decisions:
    - A pattern with `@` is one address. A pattern without `@` is a domain: it matches that domain and its subdomains (`a.firma.test` matches `firma.test`; `xfirma.test` does not). Compare in lower case, trimmed.
    - VIP is a sender flag, not a category. A VIP is also whitelisted (architecture §4.2).
    - Whitelist or VIP wins over blocklist (the safer choice: never hide mail from a whitelisted sender).
    - Blocklisted (and not whitelisted) → `spam`, no LLM call. Whitelisted or VIP → `allowed` = `classifierCategories` without `spam`. Else `allowed` = `classifierCategories`.
    - `noreply`: local part matches `noreply`, `no-reply`, `no_reply`, `donotreply`, `do-not-reply`, `mailer-daemon`, `postmaster` (case-insensitive). It is only a hint for the prompt, not a category.
    - Null or empty `from` → no rule matches, `noreply` false.
    - The "reply in a delegation thread" rule comes in S4.
  - Test: address rule; domain rule with subdomain; no false match on `xfirma.test`; case and spaces; whitelist + blocklist on the same sender → `classify` without `spam`; VIP → `vip: true, whitelisted: true`; blocklist only → `spam`; null from; noreply list.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: reading rules from the DB (stage 5), the rules CLI (stage 27).

- [x] **1.3 Threshold decision and LLM text marking**
  - Goal: turn a low-confidence answer into `unsure`, and mark risky parts of LLM text.
  - Files: create `packages/core/src/triage/threshold.ts`, `packages/core/src/triage/untrusted-text.ts` and their `*.test.ts`; export from the triage index.
  - Interfaces:
    - `decideCategory(analysis: Pick<TriageAnalysis, "category" | "confidence">, policy: CategoryPolicy): { category: Category; belowThreshold: boolean }`.
    - `markUntrustedText(text: string): string`.
  - Decisions:
    - `confidence < thresholdFor(policy, analysis.category)` → `unsure`, `belowThreshold: true`. Equal to the threshold passes.
    - Architecture §7: links, bank account numbers and phone numbers in LLM text are removed or marked. Replace URLs (`http://`, `https://`, `www.`) with `[link]`, IBAN-like numbers and runs of 20+ digits (spaces allowed) with `[account number]`, phone numbers (optional `+`, 9 or more digits with spaces or dashes) with `[phone]`. Dates like `2026-11-04` stay.
    - Email addresses (review finding 4): the `save_summary` payload carries LLM text, and the injection check (step 17.1) fails on any `@` in a payload. So replace every email address (regex `/[^\s@<>()\[\],;:"']+@[^\s@<>()\[\],;:"']+\.[^\s@<>()\[\],;:"']+/g`) with `[address]`, before the URL rule (so `mailto:` parts and `user@host` in a link also go). Then replace every `@` that is still left (for example `@janek`) with `(at)`. Result: the output of `markUntrustedText` never contains `@`.
  - Test: 0.69 → unsure, 0.7 → kept; custom threshold from the policy; marking of each pattern in Polish and English text; `"Napisz do jan.kowalski@firma.test do jutra"` → `"Napisz do [address] do jutra"`; `"Reply to x@evil.test now"` → `"Reply to [address] now"`; `"Kontakt: <anna@example.com>"` → contains `[address]` and no `@`; `"ping @janek"` → `"ping (at)janek"`; for each test input, the output does not contain `@`; a date and a short number stay.
  - Check: `bun run lint && bun run typecheck && bun run test:unit`
  - Done when: the tests pass.
  - Out of scope: calling these functions (stages 11 and 19).
