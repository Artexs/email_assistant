# F151 stage 02 — Demo run plan

Landed: `d66055cd6`.

Needs stage 01: `replayKey`, `buildReplayTable`.

Part of [`../plan.md`](../plan.md). Decisions P4, D1, D4, D5, D8.

## Goal

Pure functions pick the mail to deliver, refuse a seed that cannot give a live video, and make the gate copy.

## Interfaces (stages 04–06 use these names)

In `apps/web/e2e/lib/demo/run-plan.ts`:

```ts
type DemoMail = { key: string; from: string; subject: string; text: string | null; category: string; at: Date };
type DemoRunPlan = {
  model: string; promptVersion: string;
  mailboxB: string;      // office@<domain of A>
  history: DemoMail[];   // 20 to 60
  shadow: DemoMail[];    // 4
  urgent: DemoMail; delegation: DemoMail & { delegateName: string; delegateAddress: string };
  undo: DemoMail;
  recommended: { category: string; threshold: number | null }[];
  overdueDelegation: { delegateName: string; subject: string } | null;
};
planDemoRun(seed: DemoSeed, gates: GateFile[], productionPrompt: string): { ok: true; plan: DemoRunPlan } | { ok: false; code: string }
demoGateCopy(source: GateFile, replay: { model: string; host: "127.0.0.1" }): { file: GateFile; fileName: string; sourceProvisional: boolean }
```


## Decisions

- **Candidates.** A mail with a replay-table entry (stage 01; rule rows have none), a non-null sender and subject, and a sender that is neither mailbox A nor B. Each candidate is used once in the whole plan.
- **Confidence.** Picks need ≥ 0.7 (a new mailbox's threshold); the `undo` pick needs ≥ the gate threshold of its category (`null` = 0.7), else `decideCategory` makes it `unsure`.
- **Recommended.** Moving categories that the gate calls `go`, with thresholds (base: `info` at 0.95).
- **Sets.** `urgent`: the newest `urgent` pick. `delegation`: the newest `delegation` pick whose delegate is active in the seed and whose `fields.task` is set. `undo`: the newest pick in `recommended`, `notification` first, then `spam`, then `info`. `shadow`: 4 picks of 4 different categories from `info`, `notification`, `spam`, `needs_reply`. `history`: the remaining picks that are not `urgent` or `delegation`, newest first, at most 60.
- **Refusals**, first that holds: `demo_seed_mixed_models`, `demo_prompt_mismatch`, `demo_gate_missing`, `demo_nothing_recommended`, `demo_seed_short urgent|delegation|undo|shadow|history` (history needs 20).
- **Overdue delegation.** The newest `overdue` seed delegation with fewer than 2 reminders and an active delegate, only when A's seed settings are `assist` with `create_draft` on (`remindNow` refuses `drafts_off`); else null (D8).
- **Gate file choice.** Of the files for the model and prompt version, the one that `evidence.ts` ranks first (non-provisional, then newest date, then name).
- **Gate copy.** The source's categories, decisions and thresholds; key fields as `runningEvidenceKey` builds them for the demo server (`openai`, the model, endpoint `own`, host `127.0.0.1` without port, effort null, the source's prompt and parts). `provisional: false`, `audit: "done"`; `sourceProvisional` goes to the upload line (D10). `fileName` starts `classifier-`. Stage 04 tests the match.

## Test (`apps/web/e2e/lib/demo/run-plan.test.ts`)

A fixture builder makes a seed object; confidence 0.97 unless a case says otherwise.

1. 3 `urgent`, 2 `delegation` (one active delegate, task set), 8 each of `info`, `notification`, `spam`, `needs_reply`; a v3-shaped gate (`notification` go at 0.5, `spam` go at 0.9) → ok; `undo.category` `notification`; `shadow` has 4 categories; `history` has 27.
1a. The same seed with 4 of each of the four categories → `demo_seed_short history` (11 left).
1b. A v2-shaped gate (`info` go at 0.95), the info mails at 0.90 except one at 0.96 → `undo` is that one mail; all info at 0.90 → `demo_seed_short undo`.
2. Two prompt versions → `demo_seed_mixed_models`.
3. Rows `classifier-v2`, `productionPrompt` `classifier-v3` → `demo_prompt_mismatch`.
4. No gate file for the key → `demo_gate_missing`.
5. Every moving category `no-go` → `demo_nothing_recommended`.
6. No `urgent` pick → `demo_seed_short urgent`.
7. The only `delegation` mail has an inactive delegate, or no `task` → `demo_seed_short delegation`.
8. No key is used twice (`test.each` over 3 fixture seeds).
9. A mail with a null subject, or from mailbox A → never picked.
10. `demoGateCopy` of a provisional v3 file → `provisional: false`, endpoint `own`, decisions and thresholds equal, `classifier-` file name; `sourceProvisional: true`.
11. Overdue with 2 and with 1 reminder, A `assist` with `create_draft` → the second; `create_draft` off → null.

Break check: drop the confidence rule of `undo`; test 1b fails.

## Done when

- The tests pass.
- Proof: last line of `bun run check:job`.

## Out of scope

- IO (stages 04, 05).
