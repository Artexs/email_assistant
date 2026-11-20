# F164 stage 03 — The reply-facts set

Needs stage 02: the `sentences` field and the place in `runDrafterCase` where it is filled.
Part of [`../plan.md`](../plan.md). Decisions: P1, D3.

## Step 1 — the set file and its loader

- **Files:** a new `evals/cases/reply-facts.json`; the reply-set loader (`scripts/lib/eval-drafter-source.ts`); the eval args; `evals/README.md`.
- **Interface:**
  - `replyFactsCaseSchema = evalCaseSchema.extend({ instruction: string, mustHold: string[][] })` in the eval source module. Each inner list holds the accepted forms of one fact; any one form counts (for example `["piątek", "piątku"]`).
  - `--set reply-facts --drafter` loads it with the fixed persona of the other reply sets; state key and ledger label `reply-facts`; report title "reply facts set (dev only)". `--dump-drafts` works with it.
  - The drafter input of a case takes `instruction` from the case when it has one; every corpus case keeps `null`.
  - `--judge` is optional; then the report says its invented-commitment count is no bar here (the judge does not see the instruction).
- **Content (the worker writes it; synthetic, never from holdout):** 12 cases `rfct-01` … `rfct-12`, `sim.part` `dev`, 6 `pl` and 6 `en`, each a `needs_reply` mail with 1 to 3 questions:
  - 8 cases: the line answers every question (for example "Tak, czwartek 10:00 pasuje, umowę podpiszę w piątek");
  - 2 cases: the line answers one of two questions; the other stays a gap;
  - 2 cases: the line is in the other language (the draft keeps the mail's).
  - Each line: 1 to 300 characters, no address, link, phone or account number, nothing that asks to break a rule.
  - `mustHold`: 1 to 3 facts per case. In a same-language case each form is a word or number of the line, or an inflected form of one. In an other-language case only numbers, times and names (a person or company name of the line).
- **Frozen** after this stage: a later stage that finds a bad case asks; it never edits the file.
- **Test:**
  1. The file parses; 12 cases; 6 per language; ids unique; each `instruction` one line of at most 300 characters; each other-language form is digits, a time or a capitalised name of its line.
  2. `--set reply-facts` parses; `--set reply-fact` exits 2 with the usage line.
  3. A drafter input of a facts case holds its instruction line; a corpus case input holds `null`.
- **Check:** `bun test` on the changed tests.

## Step 2 — the facts code, at run time

- **Interface:**
  - `type FactsCode = "ok" | "no_draft" | "checks" | "no_prose" | "missing_fact" | "planted"`.
  - `runDrafterCase` stores a text-free `facts: FactsCode` for a case with `mustHold`, next to `sentences`. First match wins:
    1. `checks`: outcome `failed` with reasonCode `checks`;
    2. `no_draft`: any other outcome than `draft` (`no_draft`, `failed` with another reason, `skipped`, `error`);
    3. `planted`: `leak` is true;
    4. `no_prose`: `sentences.prose === 0`;
    5. `missing_fact`: for some fact, no form is in the body outside the gaps (case-insensitive, whole word);
    6. else `ok`.
  - `factsVerdict(results) → { passed: boolean; failures: { id: string; code: FactsCode | "not_measured" }[] }` reads only stored fields; no `facts` field is `not_measured`; `passed` only when all are `ok`.
- **Exit:** a `reply-facts` run with `passed: false` exits 1. The report lists each failing id with its code, never text.
- **Test (`test.each`):**
  1. body "Dzień dobry,\nCzwartek 10:00 mi pasuje." with facts `[["czwartek"], ["10:00"]]` → `ok`.
  2. same body, `[["piątek", "piątku"]]` → `missing_fact`.
  3. "Dzień dobry,\nW sprawie terminu: [[czwartek 10:00]]." with `[["czwartek"]]` → `no_prose`.
  4. "Dzień dobry,\nDziękuję za szybką odpowiedź.\nW sprawie terminu: [[czwartek]]." with `[["czwartek"]]` → `missing_fact` (prose exists; the fact is only in a gap).
  5. outcome `failed`, reasonCode `checks` → `checks`; outcome `failed`, reasonCode `output` → `no_draft`; outcome `no_draft` → `no_draft`.
  6. "Dzień dobry,\nUmowę podpiszę w piątku." with `[["piątek", "piątku"]]` → `ok`.
  7. 12 results, one `missing_fact`, one without the field → `passed: false`, two failures (`missing_fact`, `not_measured`).
- **Check:** `bun test` on the verdict test file; break the gap removal once and see case 4 fail.
- **Done when:** cases 1–7 and step 1's tests pass.

## Done when (stage)

Both steps done; `evals/README.md` lists the set, its bars and the freeze. Proof: the last line of `bun run check:job`.
