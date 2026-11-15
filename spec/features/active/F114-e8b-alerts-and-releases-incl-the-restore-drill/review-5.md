# F114 stage 05 review (Opus 5.5, PASS 98be04c0)

Model: Opus 5.5, because release.sh and rollback.sh run on the VPS deploy path.

No BLOCKING. All 16 stage tests pass; hostile tags (space, newline, leading dash, `../`, `;`, `$(...)`, backtick) give exit 2 with no git or docker call; a failure at each step leaves pending set, runs no later step and rollback.sh recovers; "nothing changed, no rollback needed" is true before the pending mark; rollback never restores the DB and never uses a floating tag; the `release` log key is reserved. Compose: `docker compose config --hash server` is the same with and without `EA_RELEASE` (a plain `up -d` does not recreate `server` because of the arg); the merge with F103 stage 18 is clean (`check-logging.sh`, `docker compose config`, deploy tests 44 pass).

TG1 (proven; fixed in a Sonnet continue): the disk check fails open when `df` fails (empty output makes an arithmetic error that is false inside `if`): the release continues. Fix: read the value, check `^[0-9]+$` under step `disk`, then compare.
TG2 (proven by mutant; fixed): no test covers the state-value check in `state_load`; the regex also allows a leading `-` (hand-edited `previous_commit=-q`). Reject a leading dash and test it.

Carry-over (also in stages 06 and 09):
- N1 stage 09 (unverified, no daemon): `run --rm -T cli` runs the just-built `ea-server:latest` (cli inherits image and build); `up -d --no-build` must recreate `server` after `docker tag` changes the image ID. If not, verify fails (EA_RELEASE differs) and the script exits 1. Confirm both on the VPS. Also check that the checkout commit and the image of a rollback target match (pre-<tag> uses the HEAD that ran release.sh).
- N2 stage 06 runbook: a second `rollback.sh` with no pending state swaps current and previous (goes forward again); a plain `up -d --build` stamps `EA_RELEASE=dev`; the prune removes every `ea-server:pre-*` tag except current and previous (manual `pre-<ticket>` images go); after a release or rollback the VPS checkout is detached (`git checkout master` first); a failed release needs `rollback.sh` before the next `release.sh`.
- N3: `release.sh v0.1.0 extra` ignores the extra argument; a failed `git fetch --tags` or `git show` prints no release line (exit is non-zero). Polish only.
- N4: shellcheck (via bunx) shows only false positives (SC2329, SC2034).
