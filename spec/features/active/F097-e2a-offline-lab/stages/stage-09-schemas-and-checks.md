# F097 stage 09 — Corpus file schemas, language detector, code checks

Part of [`../plan.md`](../plan.md).

After this stage the corpus file formats for texts, blind views and blind labels exist, and every written case can be checked by code against its slot (D17, D18, D25, D33).

## Step 1 — File schemas and the language detector

**Goal.** The text, blind and label files have schemas; the language of a text can be checked (D17, D18, D33).

**Files.** `packages/core/src/sim/files.ts` (new), `files.test.ts`, `packages/core/src/sim/lang.ts` (new), `lang.test.ts`.

**Interfaces.**

```ts
export const caseTextSchema = z.object({
  id: z.string(),
  subject: z.string().min(1).max(200).refine((s) => !/[\r\n]/.test(s)),
  body: z.string().max(6000),            // "" only for an html_only slot
  html: z.string().max(20000).optional(),// set iff slot.style.format === "html"
  thread: z.array(z.object({ subject: z.string().max(200), body: z.string().max(3000) }).strict()).default([]), // one per slot.thread item
  expectedPoints: z.array(z.string().min(1).max(160)).max(5).optional(), // needs_reply only (X2)
  mustNot: z.array(z.string().min(1).max(160)).max(3).optional(),        // needs_reply only (X2)
  planted: z.array(z.string().min(1).max(200)).max(3).optional(),        // injection slots (D17)
  note: z.string().max(300).optional(),  // "borderline: <reason>"
  dropped: z.literal(true).optional(),   // D34: two disagreements
}).strict();
export const textBatchFileSchema = z.object({ scenario: z.string(), part: z.enum(simParts), batch: z.string(), writer: z.string().min(1).max(80), cases: z.array(caseTextSchema) }).strict();

export const blindCaseSchema = z.object({
  id: z.string(), from: z.string(), to: z.array(z.string()), cc: z.array(z.string()),
  subject: z.string(), body: z.string(),
  thread: z.array(z.object({ from: z.string(), subject: z.string(), body: z.string() }).strict()),
  attachments: z.array(z.string()),
}).strict();
export const blindBatchFileSchema = z.object({ scenario: z.string(), part: z.enum(simParts), batch: z.string(), cases: z.array(blindCaseSchema) }).strict();
export const labelBatchFileSchema = z.object({
  scenario: z.string(), part: z.enum(simParts), batch: z.string(), checker: z.string().min(1).max(80),
  // blindHash = sha256 hex of the JSON of the case's blind entry at label time (written by `sim label-import`, stage 11);
  // a later rewrite changes the blind entry, so the label becomes stale and only that case is labelled again.
  labels: z.array(z.object({ id: z.string(), category: z.enum(valueCategories), blindHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict()),
}).strict();

export type DetectedLang = "pl" | "en" | "de" | "unknown";
export function detectLang(text: string): DetectedLang;
```

`detectLang`: lower-case words; count hits in three fixed stopword lists (about 40 words each; Polish also counts words with `ąćęłńóśźż`); the top count wins when it is ≥ 3 and ≥ 1.5 × the second; else `unknown`.

**Decisions.** D17, D18, D33.

**Test.**

1. `detectLang("Dzień dobry, proszę o przesłanie raportu do piątku. Dziękuję")` → `pl`; `"Hi Anna, could you send the report by Friday? Thanks"` → `en`; `"Guten Tag, bitte schicken Sie mir den Bericht bis Freitag"` → `de`; `"OK"` → `unknown`.
2. `caseTextSchema` refuses a subject with `\n` and an extra key.
3. `labelBatchFileSchema` accepts `delegation` and refuses `unsure` and a label without `blindHash`.

**Check.** `bun test packages/core/src/sim/files.test.ts packages/core/src/sim/lang.test.ts`

**Done when.** Cases 1–3 pass.

## Step 2 — Code checks per case and per part

**Goal.** `checkCase` and `checkSpread` return issue codes, never text (D18, D25).

**Files.** `packages/core/src/sim/checks.ts` (new), `checks.test.ts`.

**Interfaces.**

```ts
export type CaseIssueCode =
  | "text_missing" | "slot_unknown" | "address_not_reserved" | "url_not_reserved" | "phone_number"
  | "lang_mismatch" | "length_out_of_bucket" | "html_missing" | "html_unexpected" | "text_part_unexpected"
  | "signature_missing" | "urgent_keyword" | "diacritics_missing" | "attachment_not_named"
  | "planted_missing" | "expected_points_missing" | "thread_count_mismatch";
export interface CaseIssue { id: string; code: CaseIssueCode }
export function checkCase(slot: Slot, text: CaseText, scenario: Scenario): CaseIssue[];

export interface SpreadIssue { code: "length_share" | "html_share" | "lang_share"; detail: string } // counts only
export interface BatchIssue { id: string; code: "opening_repeat" } // two cases of one batch open with the same first 40 chars of body (after the greeting line)
export function checkBatch(texts: readonly CaseText[]): BatchIssue[];
export function checkSpread(slots: readonly Slot[], texts: readonly CaseText[], spec: PlanSpec, scenario: Scenario): SpreadIssue[];
```

Rules (D18): reserved hosts and phone numbers with the exported `testmail/batch.ts` helpers on subject, body, html, thread bodies; `lang_mismatch` when `detectLang(subject + body or html text) ∉ { slot.lang, "unknown" }` (for `unknown`, no issue); length in words of `body` (or the html's text with tags stripped by a simple `<[^>]+>` replace for this count only): `short` ≤ 60, `medium` 40–200, `long` ≥ 150 (overlaps on purpose: writers need slack); `html_missing` / `html_unexpected` by `slot.style.format`; `text_part_unexpected` when `html_only` and `body !== ""`; `signature_missing` when `slot.style.signature` and the persona's `signature` is not in the body or html; `urgent_keyword` for `urgent_no_keyword` (list in plan D18, word match, case-insensitive); `diacritics_missing` for `polish_diacritics` (< 5 chars of `ąćęłńóśźż`); `attachment_not_named` when an attachment name is not mentioned; `planted_missing` when a `kind: "injection"` slot has no `planted` or a planted string is not in the body/html/thread; `expected_points_missing` for `needs_reply` without `expectedPoints`; `thread_count_mismatch` when `text.thread.length !== slot.thread.length` (bank slots; a week reply's thread comes from its parent slots, so its `text.thread` is `[]`). There is no check for category words in the text: real mail says "notification" or "urgent" too; the blind checker and the owner audit catch a mail that leans on a label word. For `html` slots (not `html_only`) the writer writes both a text part (`body`) and `html`, as real mail clients do; checks run on both.

`checkSpread` (D25) on the non-dropped cases of one part: each length bucket share within ±10 points of its plan share; html share within ±5 points of the slots' share; language share within ±3 points. Signature diversity follows the persona count and is not checked; `checkBatch` catches repeated openings inside one batch.

**Decisions.** D17, D18, D25.

**Test** (one slot built by hand per case from `miniScenario`):

1. A clean `pl`, `medium`, `plain`, signature-on slot and a matching text → `[]`.
2. Body with `kontakt: jan@gmail.com` → `address_not_reserved`; with `tel. 600 700 800` → `phone_number`.
3. `urgent_no_keyword` slot whose body says `To pilne` → `urgent_keyword`.
4. `html_only` slot with a non-empty `body` → `text_part_unexpected`; a `plain` slot with `html` → `html_unexpected`.
5. Injection slot whose `planted` string is missing from the body → `planted_missing`.
6. `needs_reply` without `expectedPoints` → `expected_points_missing`.
7. Spread: 20 texts all `short` against shares 30/50/20 → one `length_share` issue; `detail` holds numbers only.
9. `checkBatch`: two texts whose bodies start with the same 40 chars after a first line `Dzień dobry,` → one `opening_repeat` naming the second id.
8. No issue `detail` or code contains any text from the case (assert on cases 2 and 7).

**Check.** `bun test packages/core/src/sim/checks.test.ts`

**Done when.** Cases 1–9 pass.
