# F164 stage 02 — The reply-facts set

Needs stage 01: `classifyReplySentences`.
Part of [`../plan.md`](../plan.md). Decisions: P1, D3.

## Step 1 — the set file and its loader

- **Goal:** a dev-only set where the manager's instruction line gives the facts, so "a full sentence where the facts are known" can be measured.
- **Files:** a new `evals/cases/reply-facts.json`; the reply-set loader of the drafter eval (`scripts/lib/eval-drafter-source.ts`); the eval args; `evals/README.md`.
- **Interface:**
  - Case schema `replyFactsCaseSchema = evalCaseSchema.extend({ instruction: string, mustHold: string[] })`, in the eval source module (not in `@ea/core`: only the eval reads it).
  - `--set reply-facts --drafter` loads it with the fixed persona of the other reply sets; the state key and ledger label are `reply-facts`; the report title says "reply facts set (dev only)".
  - The drafter input of a case takes `instruction` from the case when the case has one; every corpus case keeps `null`.
  - `--dump-drafts` works with `--set reply-facts`.
  - `--judge` is allowed but optional; the report then says "the judge does not see the instruction line: its invented-commitment count is no bar on this set".
- **Content (the worker writes it, synthetic, never from holdout):** 12 cases, `sim.part` `dev`, ids `rfct-01` … `rfct-12`, 6 `pl` and 6 `en`, each a `needs_reply` mail with 1 to 3 questions:
  - 8 cases: the line answers every question (for example "Tak, czwartek 10:00 pasuje, umowę podpiszę w piątek").
  - 2 cases: the line answers one of two questions; the other stays a gap.
  - 2 cases: the line is in the other language than the mail (the draft keeps the mail language).
  - Each line is one line of 1 to 300 characters, holds no address, link, phone or account number, and no text that asks the drafter to break a rule.
  - `mustHold`: 1 to 3 short tokens of the line that the draft must contain (a day, a time, a number, a name, a yes/no word in the draft language). For the other-language cases only language-free tokens (numbers, times, names).
- **Test:**
  1. The file parses; 12 cases; 6 per language; ids unique; every `instruction` one line of at most 300 characters; every `mustHold` token is in its instruction (for the same-language cases) or is a digit or name token (other-language cases).
  2. `--set reply-facts` parses; `--set reply-fact` answers exit 2 with the usage line.
  3. A drafter input of a facts case holds its instruction line; a corpus case input holds `null` (a fake source).
- **Check:** `bun test` on the changed test files.
- **Done when:** tests 1–3 pass.

## Step 2 — the facts verdict

- **Goal:** the run fails when a draft does not use the facts as full text.
- **Interface:** a pure `factsVerdict(results, cases) → { passed: boolean; failures: { id: string; code: FactsFailure }[] }` next to `injectionVerdict`. `FactsFailure` = `no_draft` | `checks` | `no_prose` | `missing_fact` | `planted`.
  - `no_draft`: the outcome is not `draft`.
  - `checks`: the draft failed its code checks after the retry.
  - `no_prose`: `classifyReplySentences(body).prose === 0`.
  - `missing_fact`: a `mustHold` token is not in the body outside the gaps (case-insensitive, whole token).
  - `planted`: a planted string of the case is in the body.
  The first failing code in that order is the case's code. `passed` is true only when every case has none.
- **Exit:** a `reply-facts` run with `passed: false` exits 1, as a failed injection set does. The report lists each failing id with its code, never the draft text.
- **Test (`test.each`, fake results):**
  1. body "Dzień dobry,\nCzwartek 10:00 mi pasuje." with `mustHold` ["czwartek", "10:00"] → no failure.
  2. same body, `mustHold` ["piątek"] → `missing_fact`.
  3. "Dzień dobry,\nW sprawie terminu: [[czwartek 10:00]]." with ["czwartek"] → `no_prose` (the token sits in a gap only).
  4. outcome `no_draft` → `no_draft`.
  5. code checks failed and no prose → `checks` (order).
  6. 12 results, one `missing_fact` → `passed: false`, one failure.
- **Check:** `bun test` on the verdict test file; break the gap removal once and see case 3 fail.
- **Done when:** cases 1–6 pass.
- **Out of scope:** a real run (stage 04 runs it); any judge change.

## Done when (stage)

Both steps done; `evals/README.md` lists the set and its bars. Proof: the last line of `bun run check:job`.
