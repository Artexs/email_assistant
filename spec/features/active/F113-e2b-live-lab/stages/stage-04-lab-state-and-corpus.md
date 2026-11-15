# F113 stage 04 — lab state and corpus

Part of [`../plan.md`](../plan.md). Decisions D8, D12, D13, D17. Review 1: B4, B5, T7, N2.

## Step 1 — state store

**Files.** `apps/server/src/modules/lab/state.ts` (module `lab`, stage 02 made it).

**Interfaces.**

```ts
type LabOrgKey = "lab" | "demo";
type LabOrg = { orgId: string; mailboxId: string; address: string; chatId: number };
type LabEvent =
  | { t: "inject_intent" | "inject_done"; slotId: string; messageId: string; lateBySec?: number }
  | { t: "inject_error"; slotId: string; code: string }
  | { t: "bot_planned"; key: string; at: string; reply: BotReplyPlan }
  | { t: "bot_intent" | "bot_done"; key: string; messageId: string }
  | { t: "tap_planned"; key: string; at: string; data: string; messageId: number; then?: "p" | "n" }
  | { t: "tap_intent" | "tap_done"; key: string; data: string }
  | { t: "seen"; part: string; ref: string }
  | { t: "mode"; mode: "shadow" | "assist" }
  | { t: "skip"; code: string; ref: string }
  | { t: "stopped"; reason: "done" | "budget" | "operator" | `error:${string}` };
type LabRun = { plan: LiveRunPlan; org: LabOrgKey; capUsd: number; modePlan?: { assistFromDay: number } };
createLabState(dir: string, now: () => Date): {
  readOrgs(): Partial<Record<LabOrgKey, LabOrg>>; writeOrgs(o: Partial<Record<LabOrgKey, LabOrg>>): void;
  startRun(run: LabRun): "ok" | "run_active";      // lock first, then the run folder
  readRun(id: string): LabRun; listRuns(): string[]; activeRuns(): string[];
  append(runId: string, e: LabEvent): void; events(runId: string): (LabEvent & { at: string })[];
  stopRun(runId: string, reason: StopReason): void; // the only writer of `stopped`; releases the lock
  ledgerPath(): string;                             // <dir>/eval-spend.jsonl
};
```

`BotReplyPlan`: an opaque record here; stage 08 narrows it.

**Decisions.**
- Layout: `<dir>/orgs.json`, `<dir>/runs/<runId>/{run.json,events.jsonl}`, `<dir>/locks/<org>.lock`, `<dir>/eval-spend.jsonl`.
- `startRun` takes the org lock (`O_EXCL` create) **before** it writes the run folder. `run_active` → no folder is written (review B4). A lock whose run has `stopped` is replaced.
- `stopRun` is the only writer of `stopped` (review B5). Parts return a stop signal; the serve loop (stage 11) calls `stopRun` and writes the ledger line.
- `activeRuns` = runs with no `stopped` event and a lock that names them.
- `append` writes one JSON line and syncs it before it returns; the store adds `at`.
- `events` skips a broken last line and counts it.
- The ledger is one path for the lab: `ledgerPath()`, passed to `scripts/eval-ledger.ts` as its file override. On the VPS it lives on the lab volume.

## Step 2 — corpus loader

**Interfaces.**

```ts
type LabCorpus = { scenario: Scenario; slots: Map<string, Slot>; texts: Map<string, SimText>; manifest: Manifest; parentsOf(slotId: string): Slot[] };
loadLabCorpus(root: string, scenarioId: string): Promise<LabCorpus>;
labAddresses(corpus: LabCorpus): string[];   // every scenario address, both executive mailboxes, the other-address aliases
LAB_MAILBOXES: { lab: "wiktor.szalewski@kordelan.test"; demo: "wiktor.szalewski@demo.kordelan.test" };
```

**Decisions.**
- Reads `scenario.json`, `manifest.json` and `week/` only, with the F097 readers of `scripts/sim-files.ts`. Never `holdout/` or `dev/`.
- `parentsOf` walks `parentId` to the root, root first.
- `labAddresses` is the `allowedAddresses` input of `checkSimEnv` (stage 02); stage 08 defines the alias rule (`otherAddressOf`) and this function calls it. Until stage 08 lands, the alias list is empty; stage 08 adds it and its test.
- Stages 06–15 take the corpus from this loader.

## Tests

1. Append 3 events, read them back in order; a broken last line is skipped and counted.
2. `startRun` for `lab` → `ok`; a second `startRun` for `lab` → `run_active` and no second run folder; `activeRuns()` has one id (review B4).
3. After `stopRun(r1, "done")`, `startRun` for `lab` → `ok`.
4. `stopRun` twice → one `stopped` event.
5. Two orgs (`lab`, `demo`) → two active runs at once.
6. `loadLabCorpus` on the real `lab-01` → 855 slots, 855 texts; `parentsOf` of a depth-2 reply gives 2 slots, root first.
7. The loader never opens a path under `holdout/` or `dev/` (spy on the file reads).

## Done when

Tests pass; the Proof prints `PROOF_OK`.

## Out of scope

The CLI (stage 05). Spend and caps (stage 05).
