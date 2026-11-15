# F103 stage 04: stream mutation result

Method: for each of the 102 converted calls in the 14 scripts, one mutation (`print` to `fail` or back, one line),
run the tests of that script with `--bail=1`, save a log, restore the source with `git checkout`.
Harness: one shell loop, one mutation at a time. Result at the final commit: 98 killed, 4 survive.

The 4 survivors cannot be reached by a test. Each line is a defensive handler:

| Line                                                     | Why no test reaches it                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `db-worktree.ts` `no database` after SQL state 3D000     | The database must vanish between the mark read and the `DROP`: a race.                |
| `telegram-check.ts` `config error` (not a `ConfigError`) | `loadConfig` throws only `ConfigError`.                                               |
| `telegram-check.ts` final `.catch`                       | `main` catches every error of `checkBot` and `readConfig`.                            |
| `testmail-target.ts` final `.catch`                      | `main` wraps every call after the options and the stdin read, and those do not throw. |

The mapping of these four lines is checked by comparing the old level with the new method for all 102 calls
(old `debug`/`info` to `print`, `warn`/`error` to `fail`): 14 of 14 files match.

Other facts a later stage needs:

- `eval.ts` now exports `runClassifier(options, deps)` and runs its CLI only under `import.meta.main`, like `runSim`
  in `eval-sim.ts`, so a test runs the case-set path with a fake LLM client and no network.
- The scripts `eval`, `eval-sim`, `rules`, `testmail`, `testmail-target`, `triage-cost` and `triage-label` already had a
  helper named `out` (stdout through `process.stdout.write`). Their `createCliOutput` value is named `cli`.
- `db-worktree` drop of a database in use waits 5 s in Postgres before it fails, so that test has a 20 s timeout.
- A `bun test --bail` run skips `afterAll`: the mutation runs left 60 `email_assistant_f103s04_*` databases. They were
  dropped by hand. A normal run drops its own.
