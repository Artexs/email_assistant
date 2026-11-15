# F103 stage 14 review (Opus 5.5, PASS 5105effc)

Model: Opus 5.5, because the stage is [risky] (process-wide console and crash handlers). No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (a test pins the `main.ts` wiring of the console and process guards: a child process with a preload that prints and throws) and doc drift N1 (`code-patterns.md` said "every console.* call"; only six methods are guarded).

Verified: all 5 console guard cases and both process guard cases; the guard replaces the library text with one `console_output` line (no argument is read; no recursion into the logger); restore puts back all six methods; an uncaught throw still exits 1 (mutation without `process.exit(1)` fails).

Notes:
- N1: `console.dir`, `console.table` and `console.assert` still print their text with the guard on (stage names six methods). Optional later: guard `dir`, `table`, `assert`, `dirxml`, `count`, `timeLog`. `process.stdout.write` from a library stays out of scope.
- N2: a rejection reason whose `code` getter throws makes `errorFields` throw in the `unhandledRejection` handler; Bun then reports it as `uncaughtException` (one line, exit 1, no leak). Only the event name differs.
- N3: `installProcessGuard` has no double-install check (called once). Hardening only.
- N4: the console guard ignores `LOG_LEVEL` (a drop signal at warn). Arguably right.
- N5 lint: `o["log"].info("free text")` passes (computed member, same kind as the `log['info']` limit); a non-logger `audit.log.info("free text")` is a theoretical false positive (names only).
- The worker's `/tmp/f103-s14/proof.txt` holds only `PROOF_OK`; the reviewer reran all suites.
