# F097 stage 14 — Scenario `lab-01` and its slots

Part of [`../plan.md`](../plan.md). Content stage: one writer job (Claude Sonnet 5.5, the board's worker model) writes the scenario; code plans the slots.

After this stage `evals/sim/lab-01/` holds the scenario of a made-up Polish company and all planned slots of the bank (dev, holdout) and the week, with the prior history. No mail text yet (D7, D12, D13, D19).

## Step 1 — `scenario.json`

**Goal.** One realistic executive mailbox world that passes `validateScenario` (D7, D8, P5).

**Files.** `evals/sim/lab-01/scenario.json` (new).

Content rules:

- `id: "lab-01"`. A made-up mid-size Polish company (logistics, manufacturing or distribution; about 150 people) on `<name>.test`. No real company, brand or person names. Addresses ASCII lower case on reserved hosts only (`*.test`; clients and vendors on their own `*.test` domains).
- `executive`: the managing director (`lang: "pl"`, `timeZone: "Europe/Warsaw"`), address on the company domain.
- 16–20 personas with every group of `simPersonaGroups`: `boss` 1 (the supervisory board chair), `team` 3, `delegate` 3 (an assistant, a finance person, a sales or operations person), `client` 3 (2 Polish, 1 English), `partner` 1 (English), `vendor` 2, `newsletter` 2, `marketing` 1, `system` 2 (for example an ERP and a bank notification sender, both `noreply@…`), `spammer` 1, `phishing` 1 (look-alike of a vendor domain, still `.test`). Languages: enough `en` personas in each person group to reach the bank's 40 % English (at least one `en` in `team`, `client`, `partner`, `vendor`, `newsletter`); one persona with `lang: "de"` (a German vendor or partner) for the `german` hard case.
- Each persona: `voice` (2–4 sentences: role, topics, tone, typical length, quirks; different from the others) and `signature` (a realistic sign-off line or block on one line with ` | ` separators; `""` for systems).
- `delegates`: the 3 delegate personas with 1–3 tags in Polish without diacritics (for example `faktury`, `ksiegowosc`, `umowy`, `logistyka`, `kalendarz`).
- `urgency.vip`: the `boss` and the most important client. `urgency.profile`: 3–5 topics (with 1–4 keywords each) and 3–5 deadlines (dates inside the range of `validateScenario`).
- `calendar`: `bankStart: "2027-01-11"`, `weekStart: "2027-01-25"` (both Mondays, no DST change).
- 12–20 `topics`, each with 1–4 personas who write about it.

**Decisions.** D7, D8, P4, P5.

**Test.** `bun run sim plan lab-01` (step 2) validates the scenario first.

**Check.** `bun run sim status lab-01` after step 2.

**Done when.** `validateScenario` reports no issue (the `plan` command exits 0).

**Out of scope.** Any code change. If the schema blocks a sensible scenario, stop and report it (a gap is a question).

## Step 2 — `plan-spec.json` and the slots

**Goal.** The planned corpus on disk (D13, D19).

**Files.** `evals/sim/lab-01/plan-spec.json` (new), everything `bun run sim plan lab-01` writes under `evals/sim/lab-01/` (`dev/slots/`, `holdout/slots/`, `week/slots/`, `week/history.json`).

`plan-spec.json`:

```json
{
  "seed": 2097,
  "batchSize": 25,
  "bank": {
    "devPerCategory": 53,
    "holdoutPerCategory": 210,
    "hardPerTag": 10,
    "hardDevPerTag": 3,
    "replyInjectionPerTag": 5,
    "replyInjectionDevPerTag": 2,
    "langShare": { "pl": 0.6, "en": 0.4 },
    "threadShare": 0.2
  },
  "week": {
    "weekdayMails": 150,
    "weekendMails": 40,
    "mix": { "notification": 0.35, "spam": 0.2, "info": 0.2, "needs_reply": 0.13, "delegation": 0.07, "urgent": 0.05 },
    "langShare": { "pl": 0.7, "en": 0.3 },
    "replyShare": 0.3,
    "maxThreadDepth": 5,
    "sentThreadsPerWeekday": 3,
    "offHoursShare": 0.05,
    "behaviour": { "done": 0.4, "late": 0.2, "out_of_office": 0.15, "other_address": 0.1, "silent": 0.15 },
    "historyDays": 30
  }
}
```

Expected counts: bank dev 6 × 53 + 19 × 3 + 8 × 2 = 391 slots (16 batches); holdout 6 × 210 + 19 × 7 + 8 × 3 = 1,417 (57 batches); week 830 incoming + 15 sent + their planned replies (about 35 batches). Report the real numbers.

**Decisions.** D13, D19, P3, P4.

**Test.** None beyond the command output.

**Check.** `bun run sim plan lab-01 > /tmp/f097-s14/plan.log && bun run sim status lab-01 > /tmp/f097-s14/status.log`

**Done when.** Both commands exit 0; the final message gives the batch count per part (the coordinator uses it for the stage 15 and 16 ranges).

## Proof (this stage)

```
mkdir -p /tmp/f097-s14 && bun run sim status lab-01 > /tmp/f097-s14/status.log 2>&1 && bunx prettier --check evals/sim/lab-01/scenario.json evals/sim/lab-01/plan-spec.json > /tmp/f097-s14/prettier.log 2>&1 && bun run test:unit:ci > /tmp/f097-s14/unit.log 2>&1 && echo PROOF_OK
```

Commit `scenario.json`, `plan-spec.json` and the generated files by explicit paths (`git add evals/sim/lab-01`; this one folder is the stage's output).
