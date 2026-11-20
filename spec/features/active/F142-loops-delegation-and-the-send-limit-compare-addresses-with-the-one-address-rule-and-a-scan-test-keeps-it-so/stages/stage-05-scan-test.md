# F142 stage 05 — a scan test keeps the one rule

Part of [`../plan.md`](../plan.md). Lands on the worker's proof; its land closes the ticket.

Needs stage 01: `send-limits.ts` and `triage/rules.ts` on `normalizeAddress` and `storedAddressForm`. Needs stage 02: `modules/delegation/` with no unmarked fold. Needs stages 03 and 04: `modules/loops/` and `packages/core/src/loops/` with no unmarked fold. The scan passes only on that code.
Parallel: last; runs next to nothing of this ticket.

## Step 1 — the scan (D9)

- **Goal:** a private lower-case fold in the scanned files fails the unit lane.
- **Files:** new `apps/server/src/address-rule-scan.test.ts`. Model it on `apps/server/src/comment-codes.test.ts` (Glob from `bun`, the `typescript` AST).
- **Interfaces (local to the test file):**
  - `SCANNED`: the roots `apps/server/src/modules/loops/`, `apps/server/src/modules/delegation/`, `packages/core/src/loops/` (every `.ts` file, not `*.test.ts`, not `*.test-helper.ts`) and the files `packages/core/src/send-limits.ts`, `packages/core/src/triage/rules.ts`.
  - `findings(file: string, text: string): { line: number; what: string }[]`. Flags: (a) a call whose callee is a property access named `toLowerCase` or `toLocaleLowerCase`; (b) a string literal, a no-substitution template, or a template head, middle or tail whose text matches `/\b(lower|upper)\s*\(/i` or `/\bilike\b/i`; (c) a string literal that is exactly `lower` or `upper`, in any case. A finding is cleared by a comment `// not an address: <reason>` on the same line or the line before, where the reason has at least two words. Comments themselves are never findings.
- **Test** (fixed sample strings in the test file):
  - 05-T1: `const a = address.toLowerCase();` → one finding at line 1.
  - 05-T2: ``sql`lower(g.email) = ${x}` `` → one finding; `` sql`LOWER (a)` ``, `` sql`upper(a)` ``, `` sql`a ILIKE b` `` and `eb.fn("lower", ["a"])` → one finding each.
  - 05-T3: `x.toLowerCase(); // not an address: header token` → none; the same with `// not an address:` and no reason → one finding; with `// not an address: tag` (one word) → one finding.
  - 05-T4: the marker on the line before clears; on two lines before does not.
  - 05-T5: `// address.toLowerCase()` in a comment and `normalizeAddress(x)` → none.
  - 05-T6: every root and file of `SCANNED` exists and the roots hold at least one scanned file (a rename cannot empty the scan).
  - 05-T7: `findings` over every scanned file at `HEAD` is empty. The failure message lists `file:line what` for each finding.
- **Guard check:** put `lower(g.email)` back into `delegation/repo.ts` and `.toLowerCase()` into `loops/reply-read.ts`; 05-T7 fails and names both lines; restore.
- **Done when:** `bun test apps/server/src/address-rule-scan.test.ts` passes; the guard check failed as said.

## Step 2 — leftovers and docs

- A finding that 05-T7 shows at `HEAD` (a fold that stages 02–04 missed or that master added since) is fixed by the rule, or marked when it is not an address. A fold that needs a new decision is a question in the final message.
- `docs/code-patterns.md` § Data access: one rule line — compare addresses with `normalizeAddress` (`@ea/core`) and `normalizedAddress` (`platform/db`); store, show and send `storedAddressForm`, never the rule form; an indexed `from_address_lower` compare uses `addressLowerForms`; `address-rule-scan.test.ts` covers loops, delegation, the send limit and the sender rules.
- `docs/capabilities/open-loops.md`: one line that loop creation matches delegates and own addresses by the one rule and stores the counterpart as written (trimmed, lower case).
- The styleguide is the owner's file: write the line you propose for `.agents/limen/styleguide.md` § Prefer in the final message; do not edit it.

## Out of scope

Folds outside the scanned set (plan § Decisions taken item 5). An ESLint rule.

## Done when

Steps 1–2 done, then the Proof of `plan.md` with `NN=05` prints `PROOF_OK`.
