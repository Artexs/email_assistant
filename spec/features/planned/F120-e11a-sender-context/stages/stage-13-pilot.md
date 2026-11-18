# F120 stage 13 — Pilot deploy [risky]

Part of [`../plan.md`](../plan.md). Needs stages 01–12 landed, F104 and F110 in `done/`, and the `master` CI run of the last land green.

`[risky]`: the real system. **The coordinator runs this stage itself** (`spec/build.md`: VPS steps are pre-approved; backup first, name the rollback target, verify after). No worker job; no other VPS deploy at the same time. Follow `docs/release-checklist.md` and `deploy/README.md` § Release and § Sender context (stage 12). Never a bare `up -d --build`.

## Before

1. The release tag is the first that holds F120 stage 12. Another ticket's VPS step in `git log <current tag>..<new tag>` goes first, by its runbook.
2. Release checklist: CI green on the tag; `CHANGELOG.md` `[Unreleased]` has one product line each for the Suggestions card, the sender line, the contact wait; `bun run db:check-migrations` passes.
3. The F120 migration is expand only: the current release runs on it.
4. Do not change the LLM model, provider or prompt pointer in this release (stage 11 ship is a separate owner step, Q4).

## Runbook

1. Write down the rollback target (`deploy/release-state/state`, HEAD commit).
2. `deploy/release.sh v<x.y.z>` → `release ok v<x.y.z> previous <old>`. Any other end: Rollback.
3. One-off commands in the `cli` service only.
4. Flag `sender_context` on for the pilot org (`org:flag --flag sender_context --on`; default of Q3). Then `bun run job:run --name contacts.refresh` in `cli`.

## Checks

1. `/health` → 200 with the new release.
2. `deploy/logs.sh --since 15m --event contacts_refresh_done` → one line per pilot mailbox, `count` > 0. No `contacts_refresh_mailbox_failed`.
3. `psql`: `SELECT count(*) FROM sender_profiles WHERE key_hash !~ '^[0-9a-f]{64}$'` → 0; the run time of the job line (from the log timestamps) is under 60 s per mailbox.
4. Watch 30 minutes: sync lines, no `error` event, `bun run ops:alerts` shows no open alert.
5. After 1 day (coordinator, no owner): `contact_wait` on for the pilot org; check that a new loop with `due_source = 'contact'` appears within 7 days, or record "no contact with 5 samples yet".
6. `sender_suggestions` stays off until the owner turns it on (Q3); the report lists it.

## Rollback

0. Flags off first (`org:flag --off` for the three flags).
1. Before `deploy/rollback.sh` starts the old image: fail the pending rows that stage 12 listed as unreadable by the old code (`weekly_report` with `suggestions`, digests with the brief suffix data).
2. `deploy/rollback.sh` → `rollback ok <target>`. Never `db:rollback`: the old code ignores the two tables and the `usual_reply_days` column; `due_source = 'contact'` rows read by the old loops code — the worker of stage 12 checks that the old code tolerates the value (it reads the column as text) and writes the result into the rollback section; if it does not, step 0 also runs `UPDATE open_loops SET due_source = 'default' WHERE due_source = 'contact'`.
3. Report the failing check.

## After

- Write the result into `plan.md` § Log (date, commit, check outputs, no ids); `limen ticket done`.
- One line to the owner: "Sender suggestions are ready to turn on for your org: `org:flag --flag sender_suggestions --on`, or tell me to do it."
