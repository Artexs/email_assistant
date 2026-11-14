# F097 stage 05 — Urgency profile, sender history, scenario schema

Part of [`../plan.md`](../plan.md).

After this stage `packages/core` holds the two product shapes later epics read (the urgency profile for E3b and E4-B, the sender history for E3b and E11a) and the scenario file schema with its validator. All pure code, no file IO.

## Step 1 — Urgency profile shape

**Goal.** One shape for "what is urgent for me", besides the VIP sender rules (D8, P5).

**Files.** `packages/core/src/triage/urgency-profile.ts` (new), `urgency-profile.test.ts` (new), `packages/core/src/triage/index.ts`.

**Interfaces.**

```ts
// The executive's urgency context besides VIP people (VIP people are sender rules of kind `vip`).
// E3 stores it per mailbox and puts it into the classifier prompt; E4 edits it. One shape for all three.
export const URGENCY_MAX_ITEMS = 20;
export const urgencyTopicSchema = z
  .object({ label: z.string().trim().min(1).max(80), keywords: z.array(z.string().trim().min(1).max(40)).max(10).default([]) })
  .strict();
export const urgencyDeadlineSchema = z.object({ label: z.string().trim().min(1).max(80), due: z.iso.date() }).strict();
export const urgencyProfileSchema = z
  .object({
    topics: z.array(urgencyTopicSchema).max(URGENCY_MAX_ITEMS).default([]),
    deadlines: z.array(urgencyDeadlineSchema).max(URGENCY_MAX_ITEMS).default([]),
  })
  .strict();
export type UrgencyProfile = z.infer<typeof urgencyProfileSchema>;
export const urgencySources = ["text", "vip", "context"] as const;
export type UrgencySource = (typeof urgencySources)[number];
```

**Decisions.** D8.

**Test.**

1. `{}` parses to `{ topics: [], deadlines: [] }`.
2. 21 topics → fails; a label of 81 chars → fails; `due: "2027-02-30"` → fails; an extra key → fails.
3. `{ topics: [{ label: " Fuzja z Beta " }] }` → label trimmed, `keywords: []`.

**Check.** `bun test packages/core/src/triage/urgency-profile.test.ts`

**Done when.** Cases 1–3 pass.

**Out of scope.** Storage, prompt, editor (E3b, E4-B).

## Step 2 — Sender history shape and relation class

**Goal.** Counts and flags per sender in the E11 §2.2 shape, with the relation class from code (D9).

**Files.** `packages/core/src/triage/sender-history.ts` (new), `sender-history.test.ts` (new), `packages/core/src/triage/index.ts`.

**Interfaces.**

```ts
export const senderRelations = ["delegate", "vip", "bulk", "known", "new"] as const;
export type SenderRelation = (typeof senderRelations)[number];
export const bulkSignals = ["list_id", "list_unsubscribe", "noreply", "auto_submitted"] as const;

// Counts and flags only: this type has no text field (ADR 0034).
export const senderHistorySchema = z
  .object({
    days: z.number().int().positive().max(365),
    received: z.number().int().min(0),
    byCategory: z.partialRecord(z.enum(categories), z.number().int().min(0)),
    corrections: z.partialRecord(z.enum(categories), z.number().int().min(0)),
    movedBack: z.number().int().min(0),
    answered: z.number().int().min(0),
    flagged: z.number().int().min(0),
    unseen7d: z.number().int().min(0),
    userMailsTo: z.number().int().min(0),
    lastUserMailDaysAgo: z.number().int().min(0).nullable(),
    delegationsTo: z.number().int().min(0),
    bulkSignals: z.array(z.enum(bulkSignals)),
    firstSeenDaysAgo: z.number().int().min(0).nullable(),
    relation: z.enum(senderRelations),
  })
  .strict();
export type SenderHistory = z.infer<typeof senderHistorySchema>;

// E11's order: delegate, vip, bulk (bulk signals on most mail), known (answered or wrote at least once), new.
export function relationOf(input: {
  isDelegate: boolean;
  isVip: boolean;
  received: number;
  bulkMails: number;
  answered: number;
  userMailsTo: number;
}): SenderRelation;
```

`bulk` = `bulkMails * 2 > received` (more than half). If `z.partialRecord` is not in the installed Zod, use `z.record(z.enum(categories), …)` with `.partial()` semantics the installed version supports; say which.

**Decisions.** D9.

**Test.**

1. `relationOf({ isDelegate: true, isVip: true, received: 10, bulkMails: 10, answered: 0, userMailsTo: 0 })` → `delegate`.
2. `isVip: true` (not delegate) → `vip`.
3. `received: 10, bulkMails: 6` → `bulk`; `bulkMails: 5` → not `bulk`.
4. `answered: 1` → `known`; `userMailsTo: 1` → `known`; all zero → `new`.
5. `senderHistorySchema` refuses an extra key `note` (no text field can sneak in).

**Check.** `bun test packages/core/src/triage/sender-history.test.ts`

**Done when.** Cases 1–5 pass.

**Out of scope.** Building it from the database (E11a).

## Step 3 — Scenario schema and validator

**Goal.** The scenario file of the lab has a schema and a validator that lists issues (D7, D12).

**Files.** `packages/core/src/sim/scenario.ts` (new), `scenario.test.ts` (new), `packages/core/src/sim/fixtures.ts` (new: scenario `mini`), `packages/core/src/sim/index.ts` (new), `packages/core/src/index.ts` (export `./sim`). Export from `packages/core/src/testmail/batch.ts` the helpers `isReservedHost`, `hasUnreservedAddress`, `hasUnreservedUrl`, `hasPhoneNumber` (today private) so `sim` reuses them; keep their behaviour.

**Interfaces.**

```ts
export const simPersonaGroups = [
  "boss", "team", "delegate", "client", "partner", "vendor",
  "newsletter", "marketing", "system", "spammer", "phishing",
] as const;
export const simLangs = ["pl", "en", "de"] as const;

export const simPersonaSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/),
  displayName: z.string().min(1).max(60).regex(/^[^<>"\r\n@]+$/),
  address: z.string().regex(/^[a-z0-9._+-]+@[a-z0-9.-]+$/), // ASCII, lower case; host checked by the validator
  group: z.enum(simPersonaGroups),
  lang: z.enum(simLangs),
  voice: z.string().min(1).max(500),
  signature: z.string().max(200), // "" = no signature line
}).strict();

export const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  company: z.object({ name: z.string().min(1).max(80), domain: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.test$/) }).strict(),
  executive: z.object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/),
    displayName: z.string().min(1).max(60),
    address: z.string(),
    lang: z.enum(["pl", "en"]),
    timeZone: z.literal("Europe/Warsaw"),
  }).strict(),
  personas: z.array(simPersonaSchema).min(10).max(25),
  delegates: z.array(z.object({ persona: z.string(), tags: z.array(z.string().min(1).max(30)).min(1).max(5) }).strict()).min(2).max(5),
  urgency: z.object({ vip: z.array(z.string()).max(5), profile: urgencyProfileSchema }).strict(),
  calendar: z.object({ bankStart: z.iso.date(), weekStart: z.iso.date() }).strict(),
  topics: z.array(z.object({
    key: z.string().regex(/^[a-z0-9-]{1,40}$/),
    label: z.string().min(1).max(80),
    personas: z.array(z.string()).min(1),
  }).strict()).min(5).max(30),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;

export type ScenarioIssueCode =
  | "duplicate_key" | "duplicate_address" | "address_not_reserved" | "executive_not_company"
  | "unknown_persona" | "delegate_not_delegate_group" | "vip_unknown" | "missing_group"
  | "not_monday" | "deadline_out_of_range" | "topic_persona_unknown" | "dst_in_week";
export interface ScenarioIssue { code: ScenarioIssueCode; detail: string } // ids and field names only

export function validateScenario(s: Scenario): ScenarioIssue[];
```

Validator rules: persona keys and the executive key unique; addresses unique and on a reserved host (`isReservedHost`); executive address ends with `@${company.domain}`; `delegates[].persona` exists and has group `delegate`; `urgency.vip` keys exist; every group of `simPersonaGroups` has at least one persona (`missing_group` names the group); `bankStart` and `weekStart` are Mondays; each deadline `due` lies in `[bankStart − 7 days, weekStart + 21 days]`; topic persona keys exist; the 7 days from `weekStart` have no DST change in Europe/Warsaw (compare the UTC offset of local noon on day 0 and day 6 with `Intl.DateTimeFormat`, no `Date.now()`).

`fixtures.ts`: `export const miniScenario: Scenario` — id `mini`, company `Mini Sp. z o.o.` on `mini.test`, executive `szef@mini.test`, 12 personas (one per group, two in `delegate`: `anna` tags `faktury`, `ksiegowosc` and `marek` tags `oferty`, `sprzedaz`), VIP = the `boss` persona, profile with 2 topics and 2 deadlines, `bankStart: "2026-11-02"`, `weekStart: "2026-11-16"`, 5 topics. It must pass `validateScenario` with no issue.

**Decisions.** D7, D8, D12.

**Test** (unit, each case starts from `structuredClone(miniScenario)`):

1. `miniScenario` → `[]`.
2. Two personas with the same address → one `duplicate_address`.
3. A persona address `x@gmail.com` → `address_not_reserved`.
4. Executive `szef@other.test` → `executive_not_company`.
5. A delegate pointing to the `client` persona → `delegate_not_delegate_group`.
6. Remove the only `phishing` persona → `missing_group` with detail naming `phishing`.
7. `weekStart: "2026-11-17"` (a Tuesday) → `not_monday`.
8. A deadline `due: "2027-06-01"` → `deadline_out_of_range`.
9. `weekStart: "2027-03-22"` (DST change on 2027-03-28 in Europe/Warsaw) → `dst_in_week`.
10. Issue `detail` strings contain no display name and no voice text (assert on case 2: detail names the persona keys only).

**Check.** `bun test packages/core/src/sim/ packages/core/src/testmail/`

**Done when.** Cases 1–10 pass; the old testmail tests pass.

**Out of scope.** The real scenario `lab-01` (stage 14). The planner (stages 06–07).
