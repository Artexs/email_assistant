# F157 stage 05 — split proof tool

Needs: none. May run next to 01–04.

Part of [`../plan.md`](../plan.md).

## Step 1 — `split-proof.ts`

- **Goal:** a split stage proves with one command that the parts run the same cases as the old file (plan D9).
- **Files:** `scripts/test-audit/split-proof.ts` and `split-proof.test.ts` next to it; one line in `scripts/test-audit/README.md`. Style of `cut-proof.ts` (a header comment with the usage; `parseJunit` from `./junit`). Not a `package.json` tool (`docs/cli.md` covers those only).
- **Interface (stages 06–20 use it):**
  - `splitProof(before: JunitCase[], after: JunitCase[]): { pass: boolean; lines: string[] }`, pure.
  - Key of a case: `` `${classname} :: ${name}` ``, plus ` [skipped]` when skipped. Multisets: a key that is twice in `after` and once in `before` is one `extra`.
  - `lines`, in this order: `missing <key>` per key short in `after`; `extra <key>` per key over in `after`; `assertions <key> <before> <after>` per key (present once on each side) whose `assertions` differ; last `split-proof PASS cases=<n>` or `split-proof FAIL missing=<m> extra=<e>`.
  - `pass` is false when a key is missing or extra, or when either side has 0 cases (`split-proof FAIL no cases`). An assertions line alone does not fail.
  - CLI: `bun scripts/test-audit/split-proof.ts --before <xml> --after <xml>` prints `lines` on stdout; exit 0 on pass, 1 on fail, 2 on a bad argument or an unreadable file.
- **Test** (`split-proof.test.ts`, `JunitCase` objects; `file` and `line` differ between sides in every case):
  1. Before = after = `{c:"a > d", n:"x", a:2}`, `{c:"a > d", n:"y", a:1}`, `{c:"d", n:"s", skipped}` → pass, lines `["split-proof PASS cases=3"]`.
  2. After lacks `y` → fail, `["missing a > d :: y", "split-proof FAIL missing=1 extra=0"]`.
  3. After has `x` twice (an untrimmed copy) → fail, `["extra a > d :: x", "split-proof FAIL missing=0 extra=1"]`.
  4. `s` not skipped after → fail, `missing d :: s [skipped]` and `extra d :: s`.
  5. `x` has 2 assertions before and 3 after → pass, `["assertions a > d :: x 2 3", "split-proof PASS cases=3"]`.
  6. Before empty → fail, `["split-proof FAIL no cases"]`.
  7. CLI: two XML files of case 2 in a temp folder → exit 1, the same lines on stdout. No `--after` → exit 2.
  Break the multiset count once (use a set) and see case 3 fail.
- **Done when:** `bun test scripts/test-audit/split-proof.test.ts` passes.

## Out of scope

Line counts, `git log --follow` (each split stage checks them by hand).

## Proof

`bun run check:job`, last line in the final message.
