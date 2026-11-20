# F150 stage 04 — the bare-code scan reads strings, JSON and docs

Needs stage 01: no `STRING_CODE` hit in source strings or `layers.json`. Needs stage 02: `NO_VISIBLE_TEXT` reasons without codes. Needs stage 03: `docs/modules.md` without codes.
Part of [`../plan.md`](../plan.md). Review before the land (plan § Review).

## Step 1 — extend and rename the scan

- **Goal:** one Bun test finds bare codes in comments (as today), strings, JSON values, docs site pages and `docs/modules.md`.
- **Decisions:** P1, D1, D2, D3, D12, D13.
- **Interface:** the file becomes `apps/server/src/bare-codes.test.ts` (`git mv`; fix the names that point at the old file outside `spec/` and `docs/owner-decisions.md`). Inside it:
  - `CODE` stays as it is (comments and Markdown).
  - `STRING_CODE` = the F-number, `PD-` and "stage(s) N" and "review (round) N" parts of `CODE`, without the single-letter alternative.
  - `bareCodes(file, text)` keeps its comment result and adds: string literal, no-substitution template, template head, middle and tail, and JSX text nodes (TS, TSX, MJS, JS) checked with `STRING_CODE`; for a `.json` file, every string value (keys too) of `JSON.parse(text)` with `STRING_CODE`; for a `.md` or `.mdx` file, every line with `CODE`.
  - The string and JSON part skips test files (D3): `*.test.ts`, `*.test.tsx`, `*.test-helper.ts`, files under a `test/` or `e2e/` folder. `FIXTURE_LABELS` stays for comments.
- **File set:** today's comment glob; plus `**/*.json` under the four roots (same `skipped` folders); plus `apps/docs/src/content/**/*.{md,mdx}` and `docs/modules.md`. Each hit prints `path:line: text`; JSON hits may print the JSON path instead of a line.
- **Test cases** (one `test.each` table for the unit rows; fixed values):
  1. `a.ts`, `const x = "see F115 stage 09";` → 1 hit.
  2. `a.ts`, `const x = "spec/features/done/2026-11/F115-e6a-reply-drafts/";` → 0.
  3. `a.ts`, `const f = ["S1", "P1"]; const t = "T00:00:00Z";` → 0 (letter codes are data in strings).
  4. ``a.ts``, ``const x = `a ${y} PD-083 b`;`` → 1.
  5. `a.tsx`, `const e = <p>Added in F120</p>;` → 1.
  6. `a.test.ts`, `test("T2 F115 stage 09", () => {});` → 0 (test file string).
  7. `a.json`, `{"why": "the drafter pair (F115 stages 05 to 09)"}` → 1; `{"why": "the drafter pair"}` → 0.
  8. `a.md`, `Added in S4 (F102).` → 1; `` See `spec/features/done/2026-11/F102-x/`. `` → 0; `Q3 2025 plan` → 0.
  9. The existing comment cases stay and pass, except the case that asserts a string yields no hit: it moves to the letter-code form (`const x = "D12";` → 0).
  10. Repo case: no hit in the whole file set. Keep its long timeout.
- **Break check:** add `"F999"` to a non-test string in a scanned file, see case 10 fail, revert. Do the same with a line `S4` in `docs/modules.md`.
- **New hits:** a hit that landed on master after stages 01–03 is fixed by plan D4 in this stage (merge master first).

## Step 2 — the rule text says what the scan covers

- **Decisions:** D11 (default, owner to confirm: `questions.md` Q2).
- **Do:** the bare-code sentence of `docs/code-patterns.md` § Comments, and the "Bare codes in comments" item of `.agents/limen/styleguide.md` "Avoid", name the new reach (strings outside tests, JSON values, docs site pages, `docs/modules.md`), the scan file, and that letter codes in strings are data and pass. One sentence each; the "no mass edit" rule of § Comments stays for comments.
- **Out of scope:** `docs/capabilities/`, ADRs, tool READMEs (plan P1).

## Proof

`bun test apps/server/src/bare-codes.test.ts`, then `bun run check:job`; copy its last line. The final message names each break check and the case that failed.
