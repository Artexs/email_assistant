# S6a deploy log (F077 stage 18)

- 2026-11-12, read-only, `ssh home_vm`: VPS runs commit `8f6a8b2` (rollback target). `.env.bak-s5e` is untracked there.
- 18.3 D2 list: one mailbox row: org `ac6ed6a2-ee37-461f-9632-cc08cf549e40`, mailbox `8bc7f572-a7f5-4fa5-aaab-db16dc663e96`, `active`, mode `assist`. No other mailbox: D2 holds.
- Containers: `db` up 8 days (healthy), `server` up 21 hours (healthy).
- Owner approval for the deploy and the F069 subnet move: given in chat on 2026-11-12.

## Deploy, 2026-11-12 (coordinator, owner approved in chat)

- Group review (Opus, high): `VERDICT: PASS`, 0 blocker, 4 minor. File: `spec/features/active/F077-s6a-customer-core/review-group.md`.
- Merged `master` (`cab134f`) in a clean worktree: `test:int` 1403 pass, 0 fail; `test:e2e` 50 passed; web build ok.
- Dev DB: `bun run db:migrate` applied `org_plan`, `retention_indexes`, `smtp_security`; `org:status` ok. `master` is on `origin`.
- VPS: backup ok (`ea-20261112T210926Z.dump.age`), `.env` copy `.env.bak-f069`, `git merge --ff-only` to `cab134f`, image built (disk 3.2 GB free after), `down`, `WEB_TRUSTED_PROXIES` 172.18.0.1 -> 172.30.0.1, `up -d --wait db`, `db:migrate` (3 migrations), `up -d --build --wait`.
- Checks after: gateway of `email-assistant_default` is `172.30.0.1`; `/health` ok; `org:status` pilot org `plan=active max_mailboxes=2`, `mailboxes total=1 active=1`; log start lines `scope targets: 1 active mailboxes in 1 organizations, 0 suspended organizations`, `operator notices: hourly`, `retention: daily at 02:40`; 0 error or warn lines in the first 4 minutes.
- Rollback: `git checkout 8f6a8b2` on the VPS, `.env.bak-f069` for the proxy value, `$C up -d --build --wait`.
- Open: one day of the pilot (digest, triage, error count), then the owner's OK; first panel sign-in must write a tailnet `auth_sessions.ip_address` (F069 check 3); the reset-row SQL cleanup (F059 note); then stage 18.5 (close F027, F031, roadmap line).
