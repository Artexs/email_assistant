# F114 stage 08 review (Sonnet 5.5, PASS f7e00a46)

Model: Sonnet 5.5, because the stage header names a Sonnet review (a read-only script plus docs; no migration, no new user text).

No BLOCKING. `credentials:check` counts exactly at 0, 1, 199, 200, 201 and 400 rows; a truncated or empty ciphertext, a wrong OAuth shape, another key version and another key each count `failed`; DB, role and missing-table errors exit 1 with the error name only, never `ok=0 failed=0`; no id, address or secret in stdout or stderr; the read is a plain SELECT with no lock; `restore.sh` accepts only the exact result line (hostile lines are rejected: trailing text, another prefix, a log line, empty output, CRLF, a leading space) and the real script on a valid-only DB gives `restore ok` with `up`, a wrong key gives exit 1 with no `up`. The runbook's commands, flags and paths exist; the age identity stays on the owner's machine.

TG1 (proven by mutation; fixed in a Sonnet continue): `restore.sh` takes the last exact result line (`tail -n 1`); two exact lines (`failed=2` then `failed=0`) give `restore ok`. The real script prints one line, so no false ok with real output, but count the exact result lines and fail unless the count is 1; add a test (mutation `tail` to `head` survived).
TG2 (accepted, optional): the all-valid path of the real script has no repo test (the shared test DB always has bad rows); covered by a hand probe.

Notes:
- A wrong key gives `failed>0` with exit 0 by design; `restore.sh` turns it into exit 1.
- A mailbox with no credential row counts as neither ok nor failed.
- The runbook step 2 (`git tag --sort=-v:refname | head -n 1`) prints nothing until the first tag exists (the Limits section says so).
- Plausible (stage 07 behaviour, carried to stage 09): on a new host `restore.sh` runs `up` (step 6) before the delete replay (step 7): the server can sync before erased data is removed again. Judge the order on the VPS drill.
- The runbook step 6 uses `$C down -v`: add "only on the new host, never on the live host" next to it (fixed in the continue).
