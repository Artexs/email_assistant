# F097 stage 09 — `bun run sim`: plan, status, brief, check, blind export, reconcile; the runbook

Part of [`../plan.md`](../plan.md).

After this stage an agent can create a corpus on disk from a scenario, see its state, get the facts for one writer batch, check written batches by code, export blind views for the checker and list disagreements, all by `bun run sim <command>`; and `evals/sim/README.md` tells writer and checker agents exactly what to do (D12, D17, D18, D33, D34).

## Step 1 — File layer and `plan`, `status`

**Goal.** The corpus folder layout of D12 and the first two commands.

**Files.** `apps/server/src/scripts/sim.ts` (new, the CLI), `apps/server/src/scripts/sim-args.ts` + `sim-args.test.ts` (argument parsing, the repo's `*-args.ts` pattern), `apps/server/src/scripts/sim-files.ts` + `sim-files.test.ts` (read and write the corpus files; the only fs code), `apps/server/src/scripts/sim-fixtures.test-helper.ts` (writes `miniScenario` + a small spec into a temp folder and runs `plan`; later stages reuse it), `package.json` (`"sim": "bun apps/server/src/scripts/sim.ts"`).

**Interfaces.**

```ts
// sim-files.ts
export function corpusDir(scenarioId: string, root?: string): string; // default root: <repo>/evals/sim
export function readScenario(dir: string): Scenario;                   // scenario.json, schema + validateScenario; issues → throw with codes only
export function readPlanSpec(dir: string): PlanSpec;                   // plan-spec.json
export function writeSlots(dir: string, part: SimPart, slots: readonly Slot[]): string[]; // slots/batch-NNN.json, returns paths
export function readSlots(dir: string, part: SimPart): Slot[];
export function readTexts(dir: string, part: SimPart): Map<string, CaseText>; // by slot id, from texts/*.json
export function readLabels(dir: string, part: SimPart): Map<string, ValueCategory>;
export function writeJson(path: string, value: unknown): void;         // 2-space JSON + "\n", parent dir created
```

Commands:

- `bun run sim plan <scenario> [--root <dir>]`: reads `scenario.json` and `plan-spec.json`, runs `planBank` and `planWeek`, writes `dev/slots/`, `holdout/slots/`, `week/slots/`, `week/history.json`. Refuses (exit 1, message `slots exist: use --force` or `texts exist: re-plan not allowed`) when slot files exist, unless `--force` and no `texts/` file exists in any part. Prints per part: `part <p> slots <n> batches <b>`.
- `bun run sim status <scenario> [--root <dir>]`: per part and value category: `slots`, `written` (a text that is not `dropped`), `dropped`, `labelled`, `agree`, `disagree`, `borderline`; per hard-case tag: `slots`, `written`; totals. Prints counts only. Exit 0.

**Decisions.** D12.

**Test** (unit, temp dir from `mkdtempSync(join(tmpdir(), "f097-sim-"))`, removed in `afterEach`):

1. `plan` on the mini fixture writes the three parts and `history.json`; a second `plan` without `--force` exits 1; with `--force` and no texts it rewrites identical files (byte-equal).
2. With one `texts/batch-001.json` present, `plan --force` exits 1.
3. `status` after `plan` prints `written 0` for every category and the slot counts of stage 06 test 2.
4. `sim-args`: unknown command → usage + exit 1; `--root` without a value → usage.

**Check.** `bun test apps/server/src/scripts/sim-args.test.ts apps/server/src/scripts/sim-files.test.ts`

**Done when.** Cases 1–4 pass.

## Step 2 — `brief`, `check`, `blind-export`, `reconcile`

**Goal.** The writer gets one batch's facts; code checks gate every written batch; the checker gets a truth-free view; disagreements are listed (D17, D18, D33, D34).

**Files.** `sim.ts`, `sim-files.ts`, their tests.

Commands:

- `bun run sim brief <scenario> --part <p> --batch <NNN>`: prints JSON `{ scenario: { company, executive, topics, urgency }, personas: [the personas the batch uses, with voice and signature], delegates, slots: [the batch's slots] }`. This is plan data, no mail text exists yet; stdout is allowed.
- `bun run sim check <scenario> [--part <p>] [--batches <from>-<to>]`: for each batch in range: file schemas (slots, texts, blind, labels when present), every slot has a text (`text_missing`) and every text a slot (`slot_unknown`), `checkCase` issues, then `checkSpread` for each part whose every slot has a text. Prints `case <id> <code>` lines and spread lines, then `ok` or `issues <n>`; exit 1 on any issue. Without `--part` it checks all parts. A range with no texts at all → `nothing written in range`, exit 1.
- `bun run sim blind-export <scenario> --part <p> --batches <from>-<to>`: writes `blind/batch-NNN.json` per batch from the joined case (D33: `from` = display name + address, `to`, `cc`, `subject`, `body` (the html's text for html slots, through the same `htmlBodyText` as `toEvalCase`), `thread` (from, subject, body), attachment names). Never a slot field. Skips `dropped` cases.
- `bun run sim reconcile <scenario> --part <p> --batches <from>-<to>`: prints `disagree <id> slot <category> blind <category> round <1|2>` for each case whose label differs from the slot and whose text has no `borderline:` note; round 2 when the text's `note` starts with `rewritten:` (the writer marks a rewrite so, D34). Exit 0.

**Decisions.** D17, D18, D33, D34.

**Test** (unit, temp dir, the fixture plus hand-written texts for `dev/batch-001`):

1. `check --part dev --batches 1-1` with all texts clean → `ok`, exit 0.
2. One text with `tel. 600 700 800` → `case <id> phone_number`, exit 1; stdout holds no part of the body (assert `!stdout.includes("600")`).
3. A text for an unknown slot id → `slot_unknown`.
4. `blind-export` → the blind file parses with `blindBatchFileSchema`; its JSON contains none of the strings `category`, `urgencySource`, `brief`, `expectedDelegate`, `hardCases` (keys of the slot).
5. Labels file with one case labelled differently → `reconcile` prints one `disagree … round 1` line; after the text gets `note: "rewritten: …"` → `round 2`; with `note: "borderline: …"` → no line.

**Check.** `bun test apps/server/src/scripts/sim-files.test.ts`

**Done when.** Cases 1–5 pass.

## Step 3 — The runbook

**Goal.** A writer or checker agent with no chat history can do its job from one file (P2, D17, D33, D34, D37).

**Files.** `evals/sim/README.md` (new), `evals/README.md` (a "See also" line).

Content (headings and the exact rules; write it in plain technical English):

1. **What this is.** Two frozen corpora per scenario (bank: dev + holdout; week), label first. Layout (D12). Data rule: `evals/README.md` § Data rule.
2. **Holdout rule.** "Never open `holdout/` for prompt work. Only corpus stages and the gate run read it." (P3.)
3. **Writer procedure** (Claude Sonnet): `bun run sim brief … --batch NNN` → write `texts/batch-NNN.json` (schema `textBatchFileSchema`), one text per slot, in the slot's language and the persona's voice, keeping every slot fact: the category intent of the `brief`, the length bucket, the format (html: a realistic simple HTML mail, inline styles only; `html_only`: `body` is `""`), signature (copy the persona's signature line exactly), greeting style, thread texts for `slot.thread`, attachment names mentioned in the text, headers are not text. For `needs_reply`: `expectedPoints` (what the reply must answer) and `mustNot`. For injection slots: the attack text and its `planted` strings. Never write the category name; never use a real company, person, address, phone number or URL; only the scenario's reserved domains. Vary openings, length and structure; no two mails in a batch open with the same sentence. Then `bun run sim check … --batches NNN-NNN` until `ok`. Commit only the text files of your range.
4. **Rewrite procedure** (writer, after `reconcile`): rewrite the text once so its slot label is clear, set `note: "rewritten: <short reason>"`; or, when the mail is truly ambiguous, keep it and set `note: "borderline: <short reason>"`. A second disagreement → set `dropped: true` (D34).
5. **Checker procedure** (Claude Haiku): read only `blind/batch-NNN.json` and this section; never open `slots/`, `texts/` or `plan-spec.json`. For each case pick one of `urgent`, `needs_reply`, `delegation`, `info`, `notification`, `spam` with the meanings below (copy the six meanings of `prompts/classifier-v2.ts` `MEANINGS`, as text in the README, plus "the executive's delegates are <names and tags from the scenario>"); write `labels/batch-NNN.json` (`labelBatchFileSchema`, `checker: "claude-haiku-5-5"`); then `bun run sim check … --batches NNN-NNN`.
6. **Owner audit** (filled by stage 10).
7. **Limits.** One writer job = the batch range in its spawn text; up to 3 writer jobs at once on disjoint bank ranges; week batches one job at a time in time order (threads span batches).

**Decisions.** P2, P3, D17, D33, D34, D37.

**Test.** None (docs). `bunx prettier --check evals/sim/README.md`.

**Check.** `bunx prettier --check evals/sim/README.md evals/README.md`

**Done when.** The file holds the 7 sections.

**Out of scope.** Writing any corpus text (stages 14–17). Freeze and audit commands (stage 10).
