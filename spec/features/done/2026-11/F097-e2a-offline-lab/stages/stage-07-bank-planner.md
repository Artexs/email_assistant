# F097 stage 07 — The bank planner

Part of [`../plan.md`](../plan.md). **[risky]**: the ground truth of the bank comes from here (label first, P2). Review job before the land.

After this stage a pure, seeded planner turns a scenario and a plan spec into the bank slots: the label and every planned fact per future mail, split into dev and holdout, in batches of 25 (D9, D10, D13–D16). It uses the slot schema and the hard-case registry of stage 06.

## Step 1 — The bank planner

**Goal.** `planBank(scenario, spec)` returns all bank slots, seeded, split and batched (D10, D13, D14, D16, D34).

**Files.** `packages/core/src/sim/plan-bank.ts`, `plan-bank.test.ts`, `packages/core/src/sim/briefs.ts` (brief templates), `packages/core/src/sim/history-gen.ts` (sender history per persona, D9).

**Interfaces.**

```ts
export function planBank(scenario: Scenario, spec: PlanSpec): { dev: Slot[]; holdout: Slot[] };
export function batchSlots(slots: readonly Slot[], part: SimPart, startIndex: number): Slot[]; // sets `batch` = batch-NNN, 25 per batch, in id order
export function senderHistoryFor(persona: SimPersona, scenario: Scenario, rng: Rng, days: number): SenderHistory;
```

Rules (all draws from `createRng(deriveSeed(spec.seed, "<part>:<category or tag>"))`):

1. **Category slots.** For each value category: `devPerCategory + holdoutPerCategory` slots; ids `b-<short>-0001…` (`short`: `urg`, `rep`, `del`, `inf`, `not`, `spa`); a seeded shuffle; the first `devPerCategory` go to `dev`, the rest to `holdout`.
2. **Sender group by category** (pick a persona of a random allowed group, then a random persona of it): urgent → boss, team, client, partner; needs_reply → boss, team, client, partner, vendor; delegation → boss, client, partner, vendor, team; info → team, boss, partner, client, newsletter; notification → system, newsletter; spam → marketing, spammer, phishing.
3. **Urgency source** for urgent slots: `text` 50 %, `vip` 25 %, `context` 25 % (exact counts per part by largest remainder, then shuffled). `vip` → the sender is a VIP persona. `context` → `contextRef` points to a topic or deadline of `urgency.profile` (alternate topic, deadline), sender any person group; brief "about <label>, needs action today, does not say it is urgent".
4. **Language.** Per part and category, `langShare` by largest remainder (`pl` / `en`), then the sender is picked among personas of that language when one exists in the group; else the slot keeps the language and the persona of the group (a Polish team member may write in English).
5. **Delegation.** `expectedDraft: "delegation"`, `expectedDelegate` = a seeded delegate; brief names the delegate's first tag as the task area ("a task in <tag>: …"). `delegation_missing_data` is the only `clarification` source.
6. **Style** (D14): length 30/50/20, format html 15 % (100 % for `html_only`), signature 70 % (only if the persona has one), greeting by group (`formal` for client, vendor, partner, boss 50 %; `informal` team; `none` system, newsletter, marketing, spammer, phishing).
7. **Headers** (D16, X1): every slot whose sender is a `newsletter` or `marketing` persona (any category) gets `List-Id: <persona key>.lists.<company domain>` and `List-Unsubscribe: <https://lists.<company domain>/u/<n>>` (reserved host).
8. **Threads.** `threadShare` of person-sent category slots get a `thread` of 1–2 earlier mails (persona = the executive or another person of the same topic; brief one line).
9. **receivedAt.** Bank slots spread over the 10 weekdays from `calendar.bankStart`, 07:00–19:00 Europe/Warsaw, converted with `localToInstant`; deadlines in briefs refer to these dates.
10. **Hard cases.** For each rule: `hardPerTag` slots (`replyInjectionPerTag` for the reply-injection set) with ids `h-<short>-01…`; the first `hardDevPerTag` (`replyInjectionDevPerTag`) after a seeded shuffle go to `dev`, the rest to `holdout`; categories cycled in the rule's order. Each hard slot is first built by the same builder as a category slot of its category (rules 2–9 and 11: sender by `rule.group` or the category's groups, language `rule.lang` or by share, urgency source for `urgent` — `text` for `urgent_no_keyword`, else by the 50/25/25 share — `expectedDelegate` and `expectedDraft` for `delegation`, style, headers, history), then `rule.apply` adds or overrides its facts, then `slotSchema` checks the result. A hard slot counts in its category's metrics too.
11. **Sender history** (D9, X3): every bank slot gets `senderHistory = senderHistoryFor(persona, scenario, rng, 90)`: group-typical counts (boss: received 40–80, mostly `needs_reply`/`urgent`, answered 60–90 %; system: received 50–150, all `notification`, bulk signals; phishing: received 0–2, `firstSeenDaysAgo` 0–2, relation `new`; …), `relation` from `relationOf`. The same persona gets the same history in every slot of one part (draw once per persona and part).
12. **Briefs** come from templates in `briefs.ts` keyed by category (and urgency source), filled with the topic label and names; English, ≤ 200 chars; never the category name itself ("urgent", "spam") so the writer is not told what words to use.
13. **Batches.** Category and hard slots of a part are sorted by id and cut into batches of 25 (`batch-001` …); dev and holdout number their batches independently.

**Decisions.** D9, D10, D13, D14, D15, D16, D34, P3, P4, P5, P14, X3.

**Test** (unit, `miniScenario`, spec `{ seed: 7, batchSize: 25, bank: { devPerCategory: 5, holdoutPerCategory: 20, hardPerTag: 2, hardDevPerTag: 1, replyInjectionPerTag: 1, replyInjectionDevPerTag: 0, langShare: { pl: 0.6, en: 0.4 }, threadShare: 0.2 } }`):

1. Two calls → `JSON.stringify` equal (determinism).
2. Per category: dev 5 + holdout 20 category slots; hard slots: 2 per non-reply tag (1 dev, 1 holdout), 1 per reply-injection tag (holdout).
3. No id appears in both parts; all ids unique.
4. Urgent holdout (20): `text` 10, `vip` 5, `context` 5; every `vip` slot's persona is in `urgency.vip`; every `context` slot has a valid `contextRef`.
5. Per part and category, `pl` count = round-by-largest-remainder of 0.6 × n (holdout 20 → 12 `pl`).
6. Every delegation slot without `delegation_missing_data` has `expectedDraft: "delegation"` and an `expectedDelegate` that is a scenario delegate; the missing-data slots have `clarification` and no delegate.
7. Every notification slot from a `newsletter` persona has `List-Unsubscribe` with a `.test` host.
8. Every slot parses with `slotSchema`; every `brief` (category and hard slots) is ≤ 200 chars and contains none of the words `urgent`, `spam`, `notification`, `delegation`, `needs_reply` (word match, case-insensitive).
12. Every hard slot of category `urgent` has an `urgencySource`; every hard slot of category `delegation` (except `delegation_missing_data`) has an `expectedDelegate`; every slot from a `newsletter` persona has `List-Unsubscribe`.
9. Every `receivedAt` is a weekday between `bankStart` and `bankStart + 13 days`, local hour 7–18.
10. `seed: 8` → a different dev id set for `urgent` than seed 7.
11. Batches: every batch has ≤ 25 slots; batch numbers are contiguous from `batch-001` per part.

**Check.** `bun test packages/core/src/sim/`

**Done when.** Cases 1–12 pass.

**Out of scope.** The week (stage 08). Writing files (stage 11).
