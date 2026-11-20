# F125 stage 19 — G09: weak server unit cases get exact asserts

Part of [`../plan.md`](../plan.md) § Phase B. Needs stage 08: `cut-keys.ts` (reads `audit/reject.tsv`); stage 08b: `cut-run.sh`, `cut-proof.ts`. May run next to 09–18, 20. Gets a review job on `claude-opus-5-5` (plan § Review: these cases test TLS, config secrets and deploy settings).

Group G09 (`REWRITE-WEAK`, owner `ok` except the reject list). Rows with the proposed assert: `audit/review-server-unit.md` (rows with action `REWRITE-WEAK`). Follow plan § Cut stage steps (S1–S7).

## Rows of this stage

`cut-keys --group G09`: 21 keys. Four are `rejected` (`audit/reject.tsv`): `apps/server/src/main.test.ts:42`, `:52`, `:61` (the source-regex follow-up ticket F155 replaces them) and `apps/server/src/scripts/time-rewrite-check.test.ts:43` (the file is gone). Never touch them. 17 rows remain, in `deploy-logging`, `channels/telegram/api`, `mail/imap/capture`, `mail/imap/tls-servername`, `platform/heartbeat`, `start/runs` (2), `lab/serve-files` (3), `testmail/agentmail/fake`, `platform/config-deepseek`, `platform/config` (3), `scripts/e2e-job-env-args`, `scripts/org-dsr-args`.

## Step 1 — Rewrite each case

- **D23** Rules for every `REWRITE-WEAK` row (stages 19 and 20):
  1. The new assert checks an exact value: `toBe`, `toEqual`, `toStrictEqual`, `toThrow(<type or exact message>)`, `toHaveBeenCalledWith(…)`, `toHaveLength(n)`. The row's proposal is the lead. A proposal that is itself weak (`toBeTruthy`, `toBeDefined`, a bare `not.toThrow`) becomes its exact form (for example `toBe(true)` on a boolean that the code sets).
  2. The case keeps its name, its inputs and every old assert that is still right; the weak assert goes only when the new one implies it.
  3. A case with no `expect` gets `expect.assertions(n)` only together with the exact asserts, never alone.
  4. The new assert fails at the stage base when the code breaks: break the line under test once, see the case fail, restore (one line per row in the log).
  5. A new assert that fails on the unchanged code means the code or the proposal is wrong: revert that rewrite, defer the row with the observed value, and report it (Cut stage rule 5). Never change product code.
  Reason: a rewrite that is still weak, or that hides a product bug, is worse than the old case. Rejected: accept the proposals word for word.
- Rows in a file that an open `limen/*` branch changes (rule S3; at planning time `platform/config.test.ts` was one) are deferred.

## Proof (S5)

- Before and after: the changed files (all unit).
- `--expect unit=+0`.
- An empty `diff` of the sorted JUnit `name` lists before and after.
- The lcov check must pass too: a rewrite does not drop lines.

## Out of scope

- The rejected keys.
- Other weak cases that are no G09 key.

## Done when

- `audit/cut-s19.md` holds the 17 rows with old assert, new assert, break-once result, the deferred rows with reason, the rejected keys, the `cut-proof` PASS section and the empty name diff.
- One commit, message `F125 G09 REWRITE-WEAK: exact asserts in server unit cases`.
- Last step: `bun run check:job`; copy its last line.
