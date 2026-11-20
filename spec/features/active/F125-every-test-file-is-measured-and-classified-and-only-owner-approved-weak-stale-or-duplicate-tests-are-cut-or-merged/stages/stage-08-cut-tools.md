# F125 stage 08 — Cut tools part 1: approved keys and key resolve

Part of [`../plan.md`](../plan.md) § Phase B. Needs: `audit/approval-groups.tsv`, `audit/data/cases.tsv` and the three review files (stages 01–07). May run next to 08b. Gets a review job (plan § Review).

Goal: every cut stage finds its approved cases by name with one tool, and no approved key is lost (plan Cut stage rule 2). No test or product code changes. Stage 08b builds the run and proof tools.

## Old names of the approved keys

- **D28** The core/web/tools and server-unit reviews took keys from fresh scans, so 11 approved keys have no `cases.tsv` row (plan review 3, finding 1). Write `audit/data/approved-keys.tsv` (`key`, `file`, `describePath`, `name`, `base`, `note`) from scans at each base that a review header names: core/web/tools `535e6f76`, `1d4db8b4`, `7180a84a`, `5b66ee6f`, `82151821`; server unit `8507ee9b`, `3cf7113e`. Per base: `git worktree add --detach` in `/tmp/f125-s08/`, run the HEAD `scan-cli.ts` inside it, then remove the worktree. Each approved key of these two reviews takes its triple from the scans of its own review. All scans that hold the key agree: one row. They disagree: pick the triple that the review row's evidence describes, and write why in `note`. None fits: no row. Keys of the int review use `cases.tsv` (its data base). Reason: a key is `file:line` at the base of the job that wrote it. Rejected: `cases.tsv` only (loses 11 keys); HEAD lines (they drift).

## Interface (later stages call it exactly)

**`bun scripts/test-audit/cut-keys.ts --scan <cases-static.tsv> (--group <Gnn> | --keys <k1,k2,…>) [--area <path prefix>] --out <tsv>`**

One row per key: `old_key, new_key, status, file, describePath, name`. Per key, in this order:
1. The key is in `audit/reject.tsv` → `rejected`. This comes before any lookup, so a gone file gives no error.
2. The old triple from `approved-keys.tsv`, else from `cases.tsv`. Neither → `missing`.
3. The triple in the fresh scan at the stage base: one case → `ok`; none → `deferred-none`; two or more → `deferred-two`.

A `--keys` item may also be `<file>::<name>`: a kept case named at the stage base. It skips step 2 and matches file and name in the fresh scan. `--area` keeps only keys under that prefix. Exit 0 also when rows are deferred or missing; the stage decides.

## New data file

`audit/reject.tsv` (`key`, `reason`): the 4 keys of `audit/report.md` § 3 (`time-rewrite-check.test.ts:43`, `main.test.ts:42`, `:52`, `:61`, with the full paths of `approval-groups.tsv`).

## Tests (`scripts/test-audit/cut-keys.test.ts`, pure functions, fixed values)

- T1 an old key whose name moved from line 30 to 34 → `ok`, `new_key` `…:34`.
- T2 two fresh cases with one triple → `deferred-two`; none → `deferred-none`; a `reject.tsv` key with no old row and a gone file → `rejected`.
- T7 a key in both old sources with other names → the `approved-keys.tsv` name wins; a key in neither → `missing`; `x.test.ts::a name` → `ok` with its fresh key.

Break each check once (for example skip the reject step), see its test fail, and log it.

## Docs

`scripts/test-audit/README.md`: a usage line for `cut-keys.ts` and one line on `approved-keys.tsv`.

## Done when

- `bun test scripts/test-audit` and `bunx tsc -p scripts/test-audit --noEmit` pass (logs in `/tmp/f125-s08/`).
- `cut-keys --group Gnn` for G01–G10 against a scan at the stage base prints no `missing` row, and the 4 rejected keys show `rejected`. Counts per group and status in `/tmp/f125-s08/keys.log`, copied to the final message (189 keys in all).
- One commit, then `bun run check:job` last; copy its last line.
