# F139 questions

1. [minor] D3: the Compose `db` health check stays socket-based; only `restore.sh` waits on TCP. Default: no change to `deploy/compose.yaml` (a change would recreate the live `db` at the next release). Option: change the health check to `pg_isready -h 127.0.0.1` later, in its own ticket, at a release that may restart `db`. Default, owner to confirm.
2. [minor] D2: the wait gives up after 60 probes, 1 s apart (the bound of `deploy/restore-test.sh`). Default, owner to confirm.
