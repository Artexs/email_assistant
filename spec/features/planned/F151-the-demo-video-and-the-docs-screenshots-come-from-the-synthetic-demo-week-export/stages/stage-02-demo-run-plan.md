# F151 stage 02 — Demo run plan

Needs stage 01: `replayKey`, `buildReplayTable`. May run next to 03.

Part of [`../plan.md`](../plan.md). Decisions P4, D1, D4, D5, D8.

## Goal

Pure functions pick the mail the recording delivers, refuse a seed that cannot give a live video, and make the gate copy for the replay key.

## Interfaces (stages 04 and 05 use these names)

In `apps/web/e2e/lib/demo/run-plan.ts`:

```ts
type DemoMail = { key: string; from: string; subject: string; text: string | null; category: string };
type DemoRunPlan = {
  model: string; promptVersion: string;
  mailboxB: string;                       // office@<domain of mailbox A>
  history: DemoMail[];                    // 20 to 60, newest first
  shadow: DemoMail[];                     // exactly 4
  urgent: DemoMail; delegation: DemoMail & { delegateName: string; delegateAddress: string };
  undo: DemoMail;
  recommended: string[];                  // moving categories that the gate file calls go
  overdueDelegation: { delegateName: string; subject: string } | null; // the spec finds the row by these
};
planDemoRun(seed: DemoSeed, gates: GateFile[], productionPrompt: string): { ok: true; plan: DemoRunPlan } | { ok: false; code: string }
demoGateCopy(source: GateFile, replay: { model: string; endpoint: "own"; host: "127.0.0.1" }): { file: GateFile; sourceProvisional: boolean }
```

`productionPrompt` comes from the prompt registry at `HEAD`.

## Decisions

- **Candidates.** A mail is a candidate when the replay table (stage 01) has its key, it has a `triage_results` row and its sender is not mailbox A. Each candidate is used once in the whole plan.
- **Sets.** `urgent`: the newest `urgent` candidate. `delegation`: the newest `delegation` candidate whose delegate is active in the seed. `undo`: the newest candidate in `recommended`, `notification` first, then `spam`, then `info`. `shadow`: 4 candidates of 4 different categories from `info`, `notification`, `spam`, `needs_reply`. `history`: the remaining candidates that are not `urgent` or `delegation`, newest first, at most 60.
- **Refusals**, first that holds, as `code`: `demo_seed_mixed_models` (the candidates' rows have more than one model or prompt version); `demo_prompt_mismatch` (that version is not `productionPrompt`); `demo_gate_missing` (no gate file for the model and prompt version); `demo_nothing_recommended` (no moving category is `go`); `demo_seed_short urgent|delegation|undo|shadow|history` (a set cannot be filled; history needs 20).
- **Overdue delegation.** The newest seed delegation with status `overdue`, fewer than 2 reminders and an active delegate; else null (step 7 then uses the step-6 delegation, D8).
- **Gate copy.** The copy keeps every category and decision of the source file. It takes the replay key fields (provider `openai`, the model, endpoint `own`, host `127.0.0.1`, the prompt version and parts of the source). It is written with `provisional: false` and `audit: "done"`, so the panel shows the report and the tap works. `sourceProvisional` carries the truth to the upload line (D10). The copy must match the running key of the demo server in `loadGateEvidence`; extra key fields come from the running-key builder.

## Test (`apps/web/e2e/lib/demo/run-plan.test.ts`)

A fixture builder in the test makes a seed object with N mails per category (no file, no DB).

1. A seed with 3 `urgent`, 2 `delegation` (one active delegate), 8 each of `info`, `notification`, `spam`, `needs_reply`, and a gate with `notification` and `spam` go → ok; `recommended` `["notification", "spam"]`; `undo.category` `notification`; `shadow` has 4 different categories; `history` has 27 mails.
1a. The same seed with 4 of each of the four categories → `demo_seed_short history` (11 left).
2. Two prompt versions in the rows → `demo_seed_mixed_models`.
3. Prompt `classifier-v2` in rows, `productionPrompt` `classifier-v3` → `demo_prompt_mismatch`.
4. No gate file for the key → `demo_gate_missing`.
5. Gate with every moving category `no-go` → `demo_nothing_recommended`.
6. No `urgent` candidate → `demo_seed_short urgent`.
7. The only `delegation` mail names an inactive delegate → `demo_seed_short delegation`.
8. No mail is used twice (`test.each` over 3 fixture seeds: the union of all sets has no repeated key).
9. `demoGateCopy` of a provisional v3 file → copy `provisional: false`, endpoint `own`, decisions equal; `sourceProvisional: true`.
10. Overdue delegations: one with 2 reminders, one with 1 → the delegate name and subject of the second; none → null.

Break check: let `history` take `urgent` mail; test 8 fails.

## Done when

- Tests 1–10 pass with `bun test apps/web/e2e/lib/demo/run-plan.test.ts`.
- Proof: last line of `bun run check:job`.

## Out of scope

- Reading files, starting servers, delivering mail (stage 04).
