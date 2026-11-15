# F113 stage 11 — serve loop

Part of [`../plan.md`](../plan.md). Decisions D12, D13, D15. Review 1: B5, N8.

## Goal

`bun run lab serve` is the long-lived process of the `lab` service. It drives every active run until its tail ends, survives restarts, and stops a run at its cap.

## Files

`apps/server/src/modules/lab/serve.ts`, the `serve` command in `scripts/lab.ts`.

## Interfaces

```ts
type ServeParts = {
  injector: (runId: string) => Promise<unknown>;
  bots: (runId: string) => Promise<unknown>;
  executive: (runId: string) => Promise<unknown>;
  mode: (runId: string) => Promise<void>;
  finish: (runId: string, reason: "done" | "budget" | `error:${string}`) => Promise<void>;   // stopRun + ledger line
};
serveTick(deps: { state: LabState; parts: ServeParts; now: () => Date; spendUsd: (runId: string) => Promise<number | "unpriced"> }, errors: Map<string, number>): Promise<void>;
runServe(deps, opts: { everyMs: number; signal: AbortSignal }): Promise<void>;   // everyMs 30000
```

## Decisions

- **Active run** = a run folder without a `stopped` event.
- **Order per run, per tick:** spend check; `mode`; `injector`; `bots`; `executive`; end check. Runs are handled one after another.
- **Spend.** `spendUsd(runId) ≥ capUsd` → `finish(budget)`. `unpriced` → `finish("error:unpriced")` (review N8). When the injector returns `stopped: "budget"` (stage 07), the loop calls `finish(budget)` too. `finish` is the only caller of `stopRun`, and it always writes the ledger line (review B5).
- **Mode** (demo, D15): when `modePlan.assistFromDay` is set and `now` ≥ 00:00 Warsaw of that run day, and no `mode: assist` event exists → set the mailbox mode `assist` with default switches (the `mailbox:settings mode` function), append `mode`. Runs without `modePlan` skip this part.
- **End.** `now ≥ tailEndsAt` → `finish(done)`. The tail keeps bots and executive working with no new mail (all items are due by `endsAt`).
- **Errors.** A part that throws logs its part name and an error code (no text), and the loop goes on. The error count is per run and part, and resets after a good tick. The 10th failure in a row → `finish("error:<part>")`.
- **Signals.** SIGTERM or SIGINT: finish the current part, then exit 0. A restart resumes from the events (each part is idempotent by stages 07, 08, 10).
- **Start check.** `runServe` runs `checkSimEnv` at start and exits 1 on an issue. It loads the corpus once.
- **Ledger.** `finish` writes one line with the run spend to `state.ledgerPath()` (stage 04), which the month cap of stage 05 reads.
- **Status.** `lab status` (stage 05) also shows the last tick time and the error counts, from a small `serve.json` that each tick rewrites.

## Tests (unit with fake parts and a fake clock)

1. One active run: a tick calls spend, mode, injector, bots, executive in that order.
2. A run with `stopped` is skipped.
3. Spend 5.00 of cap 5 → `finish(budget)`, no part runs, one `stopped` event and one ledger line. Spend `unpriced` → `finish("error:unpriced")`.
   3b. The injector returns `stopped: "budget"` → `finish(budget)` in the same tick; bots and executive do not run after it.
4. `now` = `tailEndsAt` → `finish(done)` once; the next tick does nothing for it.
5. Injector throws 9 times → still active; the 10th → `finish("error:injector")`; a good tick between resets the count.
6. Demo run with `assistFromDay` 4, week from 2026-11-23: at 2026-11-25T23:30Z (Thu 00:30 Warsaw) → mode set once; a second tick does not set it again.
7. Abort signal during a tick → the loop exits after that part.
8. Bad env at start → exit 1, no tick.

## Done when

Tests pass; `live-lab.md` has the serve rules (order, stop reasons, restart); the Proof prints `PROOF_OK`.

## Out of scope

Scoring (stages 12–13) and demo reset (stage 14).

## Carry-over from the stage 03 review (N6)

`deploy/compose.sim.yaml` runs the `lab` service as `bun run lab:env-check && exec bun run lab serve`. `bun run` stays PID 1 and the lab is its child, so a stop signal may not reach the lab. When this stage builds the lab script, change that command to `exec bun apps/server/src/scripts/<lab script>.ts serve`. `apps/server/src/scripts/sim-compose-rules.ts` and its test hold the old command text: change them together.

## Carry-over from the stage 10 review

- **Lock covers the executive (note 2).** The driver has no lock of its own: two parallel `runExecutiveTick` calls could both write a `tap_intent` and both press. The `O_EXCL` serve lock (carry-over N2 of stage 07) must cover `runExecutiveTick` as well as `runInjectorTick`. Test a second `lab serve` against it.
- **First-tick order (note 7).** The first `runExecutiveTick` of a run stores the newest message id and reads nothing. `live-lab.md` rule 10.3 and the comment in `executive.ts` say a tick must run before the injector sends its first mail. This stage orders injector, bots, executive. Either call the executive first on the first tick of a run, or relax that rule in `live-lab.md` (the mail sync of 2 min makes a real miss unlikely, but a card made before the baseline is lost for good).
- **Fake restart can lose cards (note 6, by design).** After a fake restart the seen id resets to the newest id. Cards the server sent to the new fake before that tick are never read. This gives lost taps, not double presses. The scorer counts the expired approvals. Do not add a retry.

## Carry-over from the stage 08 review (notes 4, 8, 9, 11)

Source: [`../review-8.md`](../review-8.md).

- **Mail client options.** One factory serves the injector and the bots: `createLabMailClient({ host, imapPort, smtpPort, password, allowedAddresses })`. It has no defaults. Build ONE client in the serve script and pass it to both ticks: `host: LAB_MAIL_HOST`, `imapPort: LAB_IMAP_PORT`, `smtpPort: LAB_SMTP_PORT`, `password: LAB_MAIL_PASSWORD` (all from `seed.ts`), `allowedAddresses: new Set(labAddresses(corpus))` (it includes the `other_address` aliases and the run mailboxes). The client refuses a non-loopback host (`host_refused`) and an envelope address outside the list (`address_refused`).
- **Order in a tick.** Run the bots tick before the first injector tick of a run. The first bots tick sets the UID cursor of each delegate inbox; no delegation mail can exist before it, because a delegation needs an executive tap.
- **One serve process per run.** Two ticks at the same time would both send a due reply. Take a lock file per run (or per org) in the serve process and refuse to start a second one.
- **Result counts.** `runDelegateBotsTick` returns `failed` too: a failed send of one reply, or a failed read of one delegate inbox (the tick goes on). Show it in the heartbeat and the status line. A reply ends after 5 failed sends (`bot_error` events, then `skip send_failed`); the scorer counts these skips.
- **Message-ID compare (stage 14).** `sendOne` reads the received mail again by UID only. After a mailbox reset that changes UIDVALIDITY, a UID can point to another mail. Stage 14 (org reset) must either reset the bot cursors and plans of the run or compare the `Message-ID` of the mail with the key of the plan before a send.

## Carry-over from the stage 07 review (N1, N2, N5)

Details: [`../review-7.md`](../review-7.md). The `LabMailClient` type is in `notes/2026-11-15-f113-s07-mail-client-for-s08.md`.

- **N1 (client host).** Build the client with `createLabMailClient` and the constants of `modules/lab/seed.ts` (see the stage 08 carry-over below for the full option list). The client already throws `host_refused` for a host that is not loopback. Add a test that the serve wiring uses these constants.
- **N2 (one writer).** `runInjectorTick` has no lock. `serve` must take an `O_EXCL` lock file (for example `<LAB_STATE_DIR>/locks/serve.lock`, freed on exit, a stale lock taken over as `state.ts` does for the org lock) before the first tick, so a second `lab serve` (for example `docker compose run lab serve`) cannot inject twice. Test: a second `serve` on the same state dir exits 1 and writes no event.
- **N5 (SDK import rule).** Add a `restrictImports` pattern in `eslint.config.js` for `imapflow`, `mailparser` and `nodemailer` on `apps/server/src/**`, with these files excluded: `modules/mail/imap/**`, `modules/lab/mail-client.ts`, `modules/lab/bots.ts` (it parses the mail of the delegate inbox with `mailparser`), `platform/auth-mail.ts` and `*.test.ts`. Run `bun run lint` to find other imports first. If this stage is full, stage 16 does it.

## Carry-over from the F111 stage 03 review

Pass the endpoint kind to the lab start check (`lab/start.ts`, unpriced-model check): an own endpoint with an unpriced model is wrongly refused; an eu endpoint with only a standard row passes and counts $0 toward the cap. See F111 `review-3.md` N3.
