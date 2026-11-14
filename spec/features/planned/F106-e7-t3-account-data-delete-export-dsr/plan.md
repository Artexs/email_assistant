# F106 plan — Account data: delete, export, data-subject requests

> **Status 2026-11-14 — planned.** Plan base: df9fe125. Eleven stages; cold review 1 in § Cold review.

**A gap or a deviation is a question in the final message, not a choice.**

## Planning progress

- [x] Collect (E07 page and notes §2, §4, §11; `tasks/planned/s6c-account-data.md`; capability pages; F105 plan; code), facts, decisions, defaults ([questions.md](questions.md)).
- [x] Stages 01–11; word counts in § Cold review.
- [x] Cold review 1: [plan-review-1.md](plan-review-1.md).

## Input

Owner words (word for word):

- 2026-11-13, E7 discovery: "Okay, so go with the default values" (PD-037–PD-050).
- PD-038: "Data-subject requests: one API command, CLI `org:dsr --find | --erase`, run by the operator on the owner's instruction; dry-run report; tombstones stop re-import; delegates and rules are listed, not deleted; audit row with a hashed address; no panel page now."
- PD-039: "Org delete and the IMAP side: leave drafts the system made in the mailbox; the delete dialog says so."
- PD-048: "Owner security log in the Account card (sign-ins, lockouts, password and 2FA changes, sessions ended, export, delete, DSR)."
- S6 P10: "Self-service "delete organization" in the Account card (password and typed confirmation), at once, through one privileged function. Backups expire after their period; the privacy policy says so. Data export: CLI `org:export` on request."
- PD-045: "every new user-visible Stage 2 behaviour ships behind one, default off."

Product decisions:

- **P1** The owner deletes the organization in the Account card: password, typed name, at once (P10, S6 D13).
- **P2** The mailbox side stays as it is; dialog and runbook say so (PD-039).
- **P3** Export: an operator CLI on request, encrypted with `age` (S6 D14).
- **P4** Data-subject requests: PD-038 and discovery notes §4.
- **P5** The security log shows export, delete, DSR (PD-048).
- **P6** The delete dialog and route sit behind the flag `org_delete`, default off (PD-045). CLIs are not user-visible: no flag.

## Facts checked (2026-11-14)

- **F1** A `BEFORE INSERT` trigger that returns NULL makes `INSERT … ON CONFLICT DO NOTHING` answer `INSERT 0 0`, no error (Postgres 18.6 probe); `insertEmail` then returns false.
- **F2** An `emails` delete by `app` removes the referencing `audit_log` rows by cascade, although `app` has no `DELETE` there (same probe).
- **F3** `age-encryption` 0.3.1 (BSD-3-Clause, npm 2026-08-28) runs in Bun: `encrypt(ReadableStream)` to a recipient; a 3 MB stream decrypts with `age` 1.3.2. New in the lock: it, `@noble/curves`, `@noble/post-quantum`, `@scure/base`.
- **F4** Better Auth 1.7.18: `auth.api.verifyPassword({ body: { password }, headers })` (server only, needs the session; wrong → `400 INVALID_PASSWORD`; `dist/api/routes/password.mjs`).
- **F5** The stage 06 pattern (Postgres look-behind) scrubs `bob@x.test.`, `<bob@x.test>`, `BOB@X.TEST` and JSON text, and leaves `jimbob@x.test` and `bob@x.test.pl`.
- **F6** `node:crypto` `hkdfSync` and `createHmac` run in Bun.
- **F7** Repo: `dedup_key` holds the Message-ID in clear; `insertEmail` is the only `emails` insert outside e2e seeds; CLIs run in the container, which has no `age` binary.

## Not verified

- The image user can write a folder mounted by `docker compose run -v` (stage 11 check 3).
- A cross-email `actions` reference (no cascade) during an erase (stage 08 test 9).

## Decisions

- **D1 Module `privacy`** (new, layer 5 next to `operator`) holds the delete service, the export, the DSR commands and the registries `EXPORT_MAP` and `DSR_ADDRESS_MAP`. Generic SQL over the registries: a registered column needs no more code. An exception to "the module that owns a text column clears it" (stage 09 documents it). Rejected: one function per owning module (six modules, and the tests still need the registry).
- **D2 One migration** (stage 01): `delete_organization`, `dsr_tombstones`, trigger `emails_skip_tombstoned`.
- **D3 Tombstones per organization**, keyed by `sha256(dedup_key)`: no Message-ID in clear; a re-connected mailbox still skips the mail. Rejected: per mailbox (backfill re-imports 180 days); a check in `insertEmail` (another insert path could skip it).
- **D4** A wrong delete password counts as a failed sign-in for the lockout (Q2).
- **D5** After the delete the web goes to `/login?deleted=1`, which lists the mailbox addresses. Rejected: a done view in the card (the `/api/me` poll gets 401 and redirects).
- **D6 Export**: one streamed read-only snapshot, encrypted to one `age` recipient, mode 600, no overwrite; `EXPORT_MAP` classifies every table and column (stage 05).
- **D7, D8** One address map with a completeness test on `information_schema`, and one address pattern for find and erase (F5, stage 06).
- **D9 Mail that goes**: the person is the sender or the only party besides the own mailbox (stage 06); other rows lose the address.
- **D10 Refusals**: a member's or own mailbox's address; open actions that name the person (stages 06, 08).
- **D11 Erase**: one transaction that locks the sync folder rows (stage 08).
- **D12 Find** prints counts and can write an encrypted report (stage 07).
- **D13 Address hash**: HMAC-SHA256, key by HKDF from `CREDENTIALS_KEY`; no new secret (Q3).
- **D14 Audit events** (stage 02): `org.delete_refused`, `org.exported`, `dsr.find`, `dsr.erase`.
- **D15 Security-log kinds** (stage 09): `data_exported`, `delete_refused`, `dsr_find`, `dsr_erase`. The org delete removes its own log, so "delete" in PD-048 is the refused attempt (Q1).
- **D16 Jobs during a delete**: a job that holds a deleted row fails its commit; a mailbox change it made stays (S6 D13).
- **D17 Personal data**: no address, organization name, password, mail text or report content in a log line, error text or audit row. CLI stdout: ids, counts, paths, byte counts; `org:delete` also prints the mailbox addresses to change.
- **D18 Seams**: E5 (Sent rows) and E11 (contacts) classify their columns in both registries (the tests fail until they do). F107 cites the stage 09 runbook.

## Done when

1. After `delete_organization`, no row of any `org_id` or `user_id` table (from `information_schema`) or `auth_verifications` of the organization or its deleted users is left; another organization and a user with another membership stay [01].
2. `org:delete` and the route delete; the route needs owner, flag, password and name, works when suspended, ends the session [02, 03].
3. The dialog deletes; the login page lists the mailbox addresses [04, 10].
4. The export decrypts to every `EXPORT_MAP` table and holds no password hash, credential, token or session [05].
5. Find and erase follow D7–D12; no rescan or backfill stores an erased mail again [06–08].
6. The security log shows the four events in pl and en; docs and runbook match the code [09].
7. The VPS runs the migration and the three CLIs on a test organization [11].

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`, `ticket.md`, this file, your stage file. Build only your stage.
- Format only your files: `bunx prettier --write <files>`.
- D17 in tests: CLI and route tests capture stdout and the log and assert that no test address, organization name or password appears.
- New log lines are events (`platform/log-fields.ts`). Test addresses end in `@x.test`.
- Only stage 01 adds a migration (version later than every file at `HEAD`); only stage 05 changes `bun.lock`.
- `git add <paths>`, never `-A`; read `git diff --staged` before each commit.

## Proof

Server stages (01, 02, 03, 05, 06, 07, 08):

```
mkdir -p /tmp/f106-sNN && bun run lint > /tmp/f106-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f106-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f106-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f106-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (04, 09): add `&& bun run web:build > /tmp/f106-sNN/web.log 2>&1` before `&& echo PROOF_OK`. Stages 10 and 11: their own.

## Owner steps

No checkpoint. U1 (optional, stage 11): decrypt the VPS test export on the Mac. U2 (any time): turn on `org_delete` where the dialog is wanted.

After stage 01 lands, the coordinator runs `bun run db:migrate` on the shared dev DB.

## Review

Before the land: stages 01–03 and 06–08 (`[risky]`), 05 (all data leaves the server), 04 and 09 (Polish text). Model `claude-opus-5-5`.

## Stages

Files in `stages/`: 01 `stage-01-migration.md` `[risky]`; 02 `stage-02-delete-service.md` `[risky]`; 03 `stage-03-delete-route.md` `[risky]`; 04 `stage-04-delete-dialog.md`; 05 `stage-05-export.md`; 06 `stage-06-address-map.md` `[risky]`; 07 `stage-07-dsr-find.md` `[risky]`; 08 `stage-08-dsr-erase.md` `[risky]`; 09 `stage-09-security-log-and-docs.md`; 10 `stage-10-e2e.md`; 11 `stage-11-vps.md` `[risky]` (the coordinator runs it).

## How to run (coordinator)

Order: 01 → 02 → 03 → 04; 05 and 06 after 01; 07 after 05 and 06; 08 after 07; 09 after 03 and 08; 10 after 04 and 09; 11 last. Spawn:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F106" \
  'Implement F106 stage NN. Read spec/features/active/F106-e7-t3-account-data-delete-export-dsr/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for this stage. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after each land.

## Cold review

Model `claude-opus-5-5`: `[risky]` stages (data delete, privacy, migration).

Word counts before review: plan 1471; stages 01–11: 693, 524, 609, 689, 699, 685, 565, 699, 643, 387, 586.

## Log

- 2026-11-14: planned.
