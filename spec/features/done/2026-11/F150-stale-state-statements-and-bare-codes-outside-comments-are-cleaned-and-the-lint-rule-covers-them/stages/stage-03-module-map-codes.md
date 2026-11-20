# F150 stage 03 — the module map holds no bare codes

Needs: nothing. May run next to 01 and 02.
Part of [`../plan.md`](../plan.md).

## Step 1 — replace the codes of `docs/modules.md`

- **Goal:** `docs/modules.md` holds no match of the `CODE` regex of `apps/server/src/comment-codes.test.ts` (F-number without slug, `PD-` number, "stage(s) N", "review (round) N", a plan letter `S D P N A Q T U` with one or two digits). At the plan base 195 lines matched: old segment names (`S0` to `S6f`), F-numbers, `A1`–`A3`, `PD-047`, "stage N".
- **Decisions:** D4, D10.
- **Rules:**
  - A provenance tag that only says which ticket or segment added a thing is dropped: "(F116, layer 3)" becomes "(layer 3)"; "since S4" goes.
  - A code that names a rule or a decision becomes the rule in a few words, or a link to the ADR or the capability page that holds it.
  - A ticket folder path (number plus slug, for example `spec/features/done/2026-11/F116-…/`) only where the reader needs the pointer to understand the text. It passes the scan.
  - A date with a quarter (`Q3 2025`) passes.
  - Keep every fact about the modules: what each owns, does, reads and imports. This stage changes no rule and adds none.
  - No other rewrite: do not split the long paragraphs or re-order sections.
- **Check:** a one-off local run of the `CODE` regex over the file finds nothing. Do not commit a script (stage 04 adds the scan).
- **Done when:** that check finds nothing, and `git diff --stat` shows only `docs/modules.md`.
- **Out of scope:** `docs/capabilities/`, ADRs, other `docs/*.md` files (plan P1); `CLAUDE.md` (stage 01).

## Edge

The active file-split ticket (F143) may edit `docs/modules.md` at the same time. On a land conflict: merge master, run the check again, re-prove.

## Proof

`bun run check:job`; copy its last line.
