# F097 stage 10 — Freeze, manifest and the owner audit commands

Part of [`../plan.md`](../plan.md).

After this stage a complete corpus can be frozen into a version with a manifest (counts and hashes), the owner's audit list of 50 cases can be made, and the owner's verdicts can be applied (D34, D35, D36).

## Step 1 — Manifest and `freeze`

**Goal.** A frozen corpus has a version, per-part hashes and counts; freezing refuses an incomplete corpus.

**Files.** `packages/core/src/sim/manifest.ts` (schema and the pure completeness rule), `manifest.test.ts`, `apps/server/src/scripts/sim.ts`, `sim-files.ts`, `sim-files.test.ts`.

**Interfaces.**

```ts
export const manifestSchema = z.object({
  scenario: z.string(),
  version: z.string().regex(/^\d+(\.\d+)?$/),        // "1", then "1.1" after an audit change
  frozenAt: z.iso.date(),
  parts: z.record(z.enum(simParts), z.object({ cases: z.number().int(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()),
  counts: z.record(z.enum(simParts), z.partialRecord(z.enum(valueCategories), z.number().int())),
  hardCases: z.record(z.string(), z.number().int()),
  audit: z.object({ status: z.enum(["pending", "done"]), list: z.string(), verdicts: z.string(), wrong: z.number().int().min(0) }).strict(),
}).strict();

export interface FreezeInput { slots: Record<SimPart, Slot[]>; texts: Record<SimPart, Map<string, CaseText>>; labels: Record<SimPart, Map<string, ValueCategory>>; spec: PlanSpec }
export type FreezeIssue = { code: "unwritten" | "unlabelled" | "open_disagreement" | "too_few" | "hard_too_few" | "week_dropped"; detail: string };
export function freezeIssues(input: FreezeInput): FreezeIssue[];
export function partHash(slots: readonly Slot[], texts: Map<string, CaseText>): string; // sha256 over JSON of [slot, text] pairs sorted by id, dropped texts excluded; node:crypto is allowed in core (eval-case.ts uses it)
```

Rules: every slot has a text (`unwritten`); every non-dropped case has a label (`unlabelled`); a label ≠ slot category without a `borderline:` note (`open_disagreement`); per value category non-dropped dev ≥ `devPerCategory − 3` and holdout ≥ 200 (`too_few`; holdout 200 is P3's floor, not the planned 210); per hard-case tag non-dropped ≥ 80 % of planned (`hard_too_few`); a dropped week case (`week_dropped`: week cases may not be dropped; they are rewritten or marked borderline, D34).

`bun run sim freeze <scenario> --version <v> --date <YYYY-MM-DD>`: runs `check` on all parts (exit 1 on any issue), then `freezeIssues` (exit 1, print codes and counts), then writes `manifest.json` with `audit.status: "pending"`. `--date` is required (no clock in the command; the stage that freezes passes the day).

**Decisions.** D34, D36, P3.

**Test** (unit; fixture corpus with all texts and labels written by the test helper):

1. A complete fixture → `freezeIssues` `[]`; `freeze` writes a manifest that parses; the same input twice → the same hashes.
2. Change one text's body → that part's hash changes, the others do not.
3. One label differs, no note → `open_disagreement`; with `borderline:` → no issue.
4. A dropped week text → `week_dropped`.
5. Holdout with 199 non-dropped cases of one category → `too_few` naming the category.

**Check.** `bun test packages/core/src/sim/manifest.test.ts apps/server/src/scripts/sim-files.test.ts`

**Done when.** Cases 1–5 pass.

## Step 2 — `audit-list` and `audit-apply`

**Goal.** The owner reviews 30 random + up to 20 contested cases; verdicts override both agents (D35, P2).

**Files.** `packages/core/src/sim/audit.ts`, `audit.test.ts`, `apps/server/src/scripts/sim.ts`, `sim-files.ts`, tests, `evals/sim/README.md` § 6 "Owner audit".

**Interfaces.**

```ts
export function pickAuditCases(input: { ids: readonly string[]; contested: readonly string[]; seed: number; version: string }): { random: string[]; contested: string[] };
// random: 30 ids by createRng(deriveSeed(seed, `audit:${version}`)) over all non-dropped ids of all parts (sorted first);
// contested: up to 20 of `contested` (cases with a `borderline:` note) not in random, by id order.

export const verdictFileSchema = z.object({
  scenario: z.string(), version: z.string(),
  verdicts: z.array(z.object({ id: z.string(), verdict: z.string().regex(/^(pending|ok|wrong: (urgent|needs_reply|delegation|info|notification|spam))$/) }).strict()),
}).strict();
export function applyVerdict(slot: Slot, verdict: string): Slot; // see rules
```

`bun run sim audit-list <scenario> --version <v>`: writes `audit/v<v>-list.md` (one section per case: id, part, slot category, urgency source, hard-case tags, `brief`, expected delegate, expected points; then the mail as the checker sees it: from, to, cc, subject, body, thread, attachment names) and `audit/v<v>-verdicts.json` with every id `pending`. Prints only the two paths and the counts. Refuses when the manifest's `audit.status` is `done` for that version.

`bun run sim audit-apply <scenario> --version <v> --date <YYYY-MM-DD>`: for each `wrong: <category>` verdict, `applyVerdict` rewrites the slot in its batch file: set `category`; for `urgent` set `urgencySource: "text"`; for `delegation` set `expectedDraft: "clarification"`; clear `urgencySource`, `contextRef`, `expectedDelegate`, `expectedDraft` where they no longer fit `slotSchema`'s rules. Then: when any slot changed, the version becomes `<v>.1` (or `+0.1`) and the hashes are recomputed; `audit.wrong` = the number of `wrong` verdicts; `audit.status` = `done` when no verdict is `pending`, else stays `pending`. Prints counts only.

README § 6 (owner audit): open `audit/v<v>-list.md`, read each case, set its line in `audit/v<v>-verdicts.json` to `ok` or `wrong: <category>`; about 15 min; the coordinator runs `audit-apply` and commits.

**Decisions.** D35, D36, P2.

**Test.**

1. `pickAuditCases` with 100 ids and 30 contested → 30 random, 20 contested, no overlap, same output twice, different with version `2`.
2. Fewer than 30 ids → all ids random, contested `[]`.
3. `applyVerdict(urgent slot with source vip, "wrong: info")` → category `info`, no `urgencySource`; the result parses with `slotSchema`.
4. `applyVerdict(info slot, "wrong: delegation")` → `expectedDraft: "clarification"`, no `expectedDelegate`.
5. `audit-apply` with one `wrong` and no `pending` → manifest version `1.1`, `audit.status: "done"`, `audit.wrong: 1`, a changed hash for that part only.
6. `audit-list` stdout holds no case text (assert it does not contain the subject of any case).

**Check.** `bun test packages/core/src/sim/audit.test.ts apps/server/src/scripts/sim-files.test.ts`

**Done when.** Cases 1–6 pass; README § 6 is written.

**Out of scope.** Running the audit (owner step O1).
