# F110 stage 08: re-gate decisions

Date: 2026-11-17. Code: `apps/server/src/modules/trust/regate.ts`, `config/service.ts` (`setCategoryGrants`), `main.ts`.

## Decisions the stage left open

- **Ready rows after a switch (stage 04 review N2).**
  - A pause turns `auto` off through `setCategoryAuto`. That call expires the `ready` `move` and `mark_read` rows of the category as `policy_changed`.
  - A re-grant (`by: regate`) keeps the `ready` rows. The old key had evidence when its grant was made, and the new key has evidence now.
  - A `legacy` stamp keeps them too: the deploy changes no behaviour.
  - The start run is before the triage worker and the committer. The committer has no policy re-check of its own: the expiry is the guard.
- **A history end hook that throws every time (stage 07 review N5).**
  - The end of a `done` check fails the step. The step costs one attempt per run (3 attempts).
  - The third attempt (and the take-back of a stale lock on the third attempt) ends the check `no_result` / `stopped`. The hook runs under a savepoint: its failure is rolled back and logged as `history_ended_hook_failed`; the check still ends, with no notice.
- **`llm_calls_today` and history calls (stage 07 review N2).** Not changed. No operator need is known; the daily cap leaves history calls out on purpose.
- **Too few cases.** A final `too-few` file for the same key withdraws an `evidence`, `recommended` or `regate` grant like a `no-go` file: the gate (`autoEvidence`) refuses `too-few` too.
- **Failures at start.** A mailbox that fails alone is logged (`trust_regate_mailbox_failed`) and the start goes on; the job retries it in 5 minutes. A `ready` move of that mailbox could still be applied under the old key in that window. A failure of the whole run (the database) stops the server.
- **`paused` count.** It counts categories turned off, also when a trip for the same grant existed already (then no second notice).
