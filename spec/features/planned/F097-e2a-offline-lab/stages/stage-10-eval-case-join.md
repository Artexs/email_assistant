# F097 stage 10 — Eval case extension and the join

Part of [`../plan.md`](../plan.md).

After this stage a slot plus its text (and, for a week reply, its parents) becomes an `EvalCase` the existing runner can classify; the old 108 cases keep the same classifier input (D20, D21).

## Step 1 — Eval case extension and the join

**Goal.** A slot plus its text becomes an `EvalCase`; the old cases are unchanged (D20, D21).

**Files.** `packages/core/src/triage/eval-case.ts`, `eval-case.test.ts`, `packages/core/src/sim/to-eval-case.ts` (new), `to-eval-case.test.ts`, `apps/server/src/modules/triage/eval.ts` (`toClassifierInput` only), `apps/server/src/modules/triage/eval-cases.test.ts`, `apps/server/src/modules/mail/index.ts` (export `bodyTextFromSource` if it is not exported).

**Interfaces.**

```ts
// eval-case.ts (additions only)
lang: z.enum(["pl", "en", "de"]),
receivedAt: z.iso.datetime().optional(),
thread: z.array(z.object({ from: z.string(), subject: z.string(), body: z.string(), receivedAt: z.iso.datetime().optional() })).default([]),
sim: z.object({
  corpus: z.string(), version: z.string(), part: z.enum(["dev", "holdout", "week"]), slotId: z.string(),
  urgencySource: z.enum(urgencySources).optional(),
  hardCases: z.array(z.string()).default([]),
  senderHistory: senderHistorySchema.optional(),
  urgencyProfile: urgencyProfileSchema.optional(),
  headers: z.record(z.string(), z.string()).default({}),
  attachments: z.array(z.object({ name: z.string(), mime: z.string(), sizeBytes: z.number() })).default([]),
  expectedPoints: z.array(z.string()).optional(),
  mustNot: z.array(z.string()).optional(),
  planted: z.array(z.string()).optional(),
}).strict().optional(),

// to-eval-case.ts
export async function toEvalCase(
  input: {
    slot: Slot; text: CaseText; scenario: Scenario; corpusVersion: string;
    parents?: readonly { slot: Slot; text: CaseText }[]; // week replies: the parent chain, oldest first, at most 3
  },
  deps: { htmlBodyText(input: { subject: string; html: string; from: string; to: string[]; date: Date }): Promise<string | null> }
): Promise<EvalCase>;
```

Join rules: `id` = slot id; `kind` = slot kind; `from` = `${persona.displayName} <${slot.fromOverride ?? persona.address}>`; `to`/`cc` = addresses of the keys (executive or personas); `subject`; `body` = `text.body` when it is not empty (the text part wins, as in `bodyTextFromSource`), else (`html_only`) `await deps.htmlBodyText(...)` (D21; the script passes `renderSeedMessage` + `bodyTextFromSource`; a `null` result → `""`); `thread` = for a bank slot, `slot.thread` joined with `text.thread` (from = the thread persona's address, `receivedAt` = slot time − (n − i) hours); for a week slot with `parents`, one item per parent (from = the parent's sender address, subject, body = the parent's text part or html text, `receivedAt` = the parent slot's time); `senderRules` = one `vip` rule per `urgency.vip` persona address; `delegates` = scenario delegates as `{ key: persona key, name: displayName, tags }`; `expected` = `{ category, delegate: expectedDelegate, draft: expectedDraft }`; `receivedAt` = slot time; `sim` = the slot facts and the text's `expectedPoints`, `mustNot`, `planted`, with `urgencyProfile = scenario.urgency.profile`. `lang`: `de` stays `de`.

`toClassifierInput` (`eval.ts`): `receivedAt: c.receivedAt === undefined ? EVAL_RECEIVED_AT : new Date(c.receivedAt)`; thread items use their own `receivedAt` when set, else today's rule. Nothing else in `eval.ts` changes in this stage.

**Decisions.** D20, D21.

**Test.**

1. Every case of `evals/cases/*.json` parses; for each, `toClassifierInput` gives the same object as before this stage (pin: compare against a copy of the old function kept in the test file).
2. `toEvalCase` of a `plain` slot → `from` is `Display <address>`, `expected.category` = slot category, `sim.slotId` = slot id, `senderRules` holds the VIP rules.
3. An `html_only` slot → `body` = the value `htmlBodyText` returned (fake dep returning `"from html"`), and the fake was called once with the text's `html`; an `html` slot with a non-empty `body` → `body` = that text and the fake was not called.
4. A `bounce` slot → the `from` address is the `fromOverride`.
5. A slot with a 2-mail thread → `thread[0].receivedAt` 2 h before, `thread[1]` 1 h before the case.
6. The result parses with `evalCaseSchema`.
7. With the real `bodyTextFromSource` (in `eval-cases.test.ts`, no DB): an `html_only` text `<p>Dzień <b>dobry</b></p>` joins to a body that contains `Dzień dobry`.
8. A week reply with 2 parents → `thread` has 2 items in time order with the parents' subjects and slot times.


**Check.** `bun test packages/core/src/triage/eval-case.test.ts packages/core/src/sim/ apps/server/src/modules/triage/eval-cases.test.ts apps/server/src/modules/triage/eval.test.ts`

**Done when.** Cases 1–8 pass; `eval.test.ts` passes unchanged.

**Out of scope.** Loading files from disk (stage 11, 13).
