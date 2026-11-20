# F143 stage 05 — core text tables by locale

Needs: nothing. May run next to every other stage.
Part of [`../plan.md`](../plan.md).

## Goal

The three text tables of `packages/core/src/texts/` over 400 lines (`notices.ts` 599, `bot.ts` 529, `approvals.ts` 507) become one file per locale. Every text, every plural rule and every export stays the same (D7, D8, D15).

## Decision D15 (this stage; default, owner to confirm)

Split by locale, not by group: `<table>.ts` keeps the key lists, the interface and the assembled table; `<table>-en.ts` and `<table>-pl.ts` hold one locale object each. A locale file over 400 lines splits again by group (`<table>-pl-<group>.ts`, spread into the locale object). Reason: each locale part is about 200 lines, the interface stays one type, and `satisfies Record<UserLocale, …>` keeps checking both locales. Rejected: a group split first, as in `apps/web/src/i18n/texts/` (the web tables are flat key maps; these are nested objects with functions, so a group split needs `Pick<>` types per group and more churn for no file under the limit).

## Step 1 — the split

- For each table `T` in `notices`, `bot`, `approvals`:
  - `texts/T.ts`: the key lists and types it exports at `HEAD` (`replyResultKeys`, `botCommandNames` …), the interface, and `export const <name> = { en: <name>En, pl: <name>Pl } satisfies Record<UserLocale, <Interface>>` with the `HEAD` export name (`noticeTexts`, `botTexts`, `approvalTexts`).
  - `texts/T-en.ts`: `export const <name>En: <Interface> = { … }` and the `EN_*` helpers it alone uses.
  - `texts/T-pl.ts`: the same for `pl` with the `PL_*` helpers and `plDecimal` / `plReminders`.
  - A helper that both locales use goes to a leaf file `texts/T-common.ts` that imports neither locale file (D16: no value import cycle).
- `texts/index.ts` and every importer keep their imports (`./notices`, `./bot`, `./approvals`). The `<name>En` and `<name>Pl` names are internal to the `texts/` folder: `index.ts` does not re-export them.
- **Method:** D5 for the history: `history-copies.sh` with the two new names per table, then trim. The locale objects are carved out of one `const`, so `same-bodies.ts` does not fit; the proof is D8.

## Test

No new test file. Move proofs in `/tmp/f143-s05/`:

1. **Dump proof (D8):** a script in `/tmp/f143-s05/` imports `textsFor` from `packages/core/src/texts/index.ts` and writes, for `en` and `pl`, every key path of the three tables in order, with a string as its value and a function as its source text with whitespace runs collapsed to one space. Run it before the first change of the stage (base) and after the trim (head). `diff` prints nothing.
2. **Call proof:** the same script calls every function of the three tables with fixed arguments (`1`, `2`, `5`, `22` for a count; `"x"` for a string; the worker picks the rest from the interface) and writes the results, before the first change and after the trim; `diff` prints nothing. This catches a helper bound to the wrong locale.
3. `exports-of.ts` of each base `T.ts` equals that of the new `T.ts`.
4. Each new file: `git log --follow` reaches the first commit of its table.
5. `wc -l` of every file in `texts/` ≤ 400.
6. Mutation check: change one Polish word in `notices-pl.ts`; check 1 prints one diff line. Revert. Write it in the final message.

Existing guards, unchanged: `texts/bot.test.ts`, `index.test.ts`, `locale.test.ts`, and the typecheck of `satisfies Record<UserLocale, …>`.

## Done when

- Checks 1–6 passed; the logs are named in the final message.
- Proof: `plan.md` § Proof with `NN=05`.

## Out of scope

Other text files (all under 400). A text change, a new key, the operator texts that the one-operator-alert-path ticket (F147) moves into `texts/operator.ts`.
