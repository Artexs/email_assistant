# F106 plan — Account data: delete, export, data-subject requests

> **Status 2026-11-14 — planned.** Plan base: df9fe125. Twelve stages; cold review 1 applied (§ Cold review).

**A gap or a deviation is a question in the final message, not a choice.**

## Planning progress

- [x] All steps done; defaults in [questions.md](questions.md).

## Input

Owner words (word for word):

- 2026-11-13, E7 discovery: "Okay, so go with the default values" (PD-037–PD-050).
- PD-038: "Data-subject requests: one API command, CLI `org:dsr --find | --erase`, run by the operator on the owner's instruction; dry-run report; tombstones stop re-import; delegates and rules are listed, not deleted; audit row with a hashed address; no panel page now."
- PD-039: "Org delete and the IMAP side: leave drafts the system made in the mailbox; the delete dialog says so."
- PD-048: "Owner security log in the Account card (sign-ins, lockouts, password and 2FA changes, sessions ended, export, delete, DSR)."
- S6 P10: "Self-service "delete organization" in the Account card (password and typed confirmation), at once, through one privileged function. Backups expire after their period; the privacy policy says so. Data export: CLI `org:export` on request."
- PD-045: "every new user-visible Stage 2 behaviour ships behind one, default off."

Product decisions:

- **P1–P5** as the quotes: self-service delete (S6 D13), mailbox side unchanged (PD-039), export CLI with `age` (S6 D14), DSR (PD-038, notes §4), security log (PD-048).
- **P6** The delete dialog and route sit behind the flag `org_delete`, default off (PD-045); CLIs have no flag.

## Facts checked (2026-11-14)

- **F1** A `BEFORE INSERT` trigger that returns NULL makes `INSERT … ON CONFLICT DO NOTHING` answer `INSERT 0 0`, no error (Postgres 18.6 probe); `insertEmail` then returns false.
- **F2** An `emails` delete by `app` cascades to `audit_log`, although `app` has no `DELETE` there (same probe).
- **F3** `age-encryption` 0.3.1 (BSD-3-Clause, npm 2026-08-28) runs in Bun: `encrypt(ReadableStream)`; a 3 MB stream decrypts with `age` 1.3.2.
- **F4** Better Auth 1.7.18 has `auth.api.verifyPassword({ body: { password }, headers })` (server only, session needed; wrong → `400 INVALID_PASSWORD`).
- **F5** The stage 06 pattern (Postgres look-behind) scrubs `bob@x.test.`, `<bob@x.test>`, `BOB@X.TEST` and JSON text, and leaves `jimbob@x.test`, `bob@x.test.pl`, `o'bob@x.test`, `łbob@x.test`, `bob@x.test_x` and `bob@x.testé` (the look-behind and look-ahead classes were widened after the Opus review of stage 06; exact classes in stage 06).
- **F6** `hkdfSync` and `createHmac` run in Bun.
- **F7** `dedup_key` holds the Message-ID in clear; `insertEmail` is the only `emails` insert outside e2e seeds; the container has no `age` binary; `AuditData` is flat.
- **F8** Sync and backfill apply chunks through `applyChunk` → `lockSyncFolder` (`modules/mail/sync.ts`).
- **F9** Digest rows hold rendered text, no mail id; senders are cut to 40 characters (`senderLabel`; review 1).

## Not verified

- The image user can write a folder mounted by `docker compose run -v` (stage 12 check 3).
- Whether `weekly_report` text names a mail (stage 09 reads the renderer).

## Decisions

- **D1 Module `privacy`** (new, layer 5) holds delete, export, DSR and the registries `EXPORT_MAP`, `DSR_ADDRESS_MAP`. Generic SQL over the registries: a registered column needs no more code. An exception to "the module that owns a text column clears it" (stage 10). Rejected: one function per owning module (six modules; the tests still need the registry).
- **D2 One migration** (stage 01): `delete_organization`, `dsr_tombstones`, a trigger on `emails`.
- **D3 Tombstones per organization**, keyed by the SHA-256 of the base dedup key (no `#n`): no Message-ID in clear; a re-connected mailbox and a later copy are skipped. Rejected: per mailbox (backfill re-imports 180 days); a check in `insertEmail` (another insert path could skip it).
- **D4** A wrong delete password counts for the sign-in lockout (Q2).
- **D5** After the delete the login page lists the mailbox addresses (stage 04). Rejected: a done view in the card (the `/api/me` poll gets 401 and redirects).
- **D6 Export**: a streamed read-only snapshot, encrypted to one `age` recipient, mode 600, no overwrite; `EXPORT_MAP` classifies every table and column (stage 05).
- **D7, D8** One address map (completeness test on `information_schema`) and one pattern for find and erase (stage 06).
- **D9 Mail that goes**: the person is the sender, the only Reply-To (Q14), or the only party besides the organization's own mailboxes (stage 06); other rows lose the address.
- **D10 Refusals**: a member's or own mailbox's address; an open send or draft of a mail that goes; an open action of a kept mail that names the person (stage 06). Kept-mail actions that point at an action of a mail that goes are deleted with it.
- **D11, D12** Erase is one transaction that locks the sync folder rows (F8, stage 08); find prints counts and can write an encrypted report (stage 07).
- **D13 Address hash**: HMAC-SHA256, key by HKDF from `CREDENTIALS_KEY`; no new secret (Q3).
- **D14 Audit events** (stage 02, flat data): `org.delete_refused`, `org.exported`, `dsr.find`, `dsr.erase`.
- **D15 Security-log kinds** (stage 10): `data_exported`, `delete_refused`, `dsr_find`, `dsr_erase`. The org delete removes its own log, so "delete" in PD-048 is the refused attempt (Q1).
- **D16** A job that holds a deleted row fails its commit; its mailbox change stays (S6 D13).
- **D17**: no address, organization name, password, mail text or report content in a log line, error text or audit row. CLI stdout: ids, counts, paths, sizes; `org:delete` also prints the mailbox addresses.
- **D18 Seams**: E5 (Sent rows, F104) and E11 (contacts) classify their columns in both registries, and a new mail table gets the tombstone trigger; tests fail until they do. F107 cites the stage 10 runbook.
- **D19** After an erase, digest and approval-set rows since the earliest erased mail are blanked and pending digests dropped (the `delete_mailbox` rule; F9; stage 09).
- **D20** The runbook keeps each delete and erase line off the server and repeats them after a backup restore (Q15).

## Done when

1. After `delete_organization` no row of the organization or its deleted users is left in any `org_id` or `user_id` table or `auth_verifications`; another organization and a multi-member user stay [01].
2. `org:delete` and the route delete; the route needs owner, flag, password, name, works when suspended, ends the session [02, 03].
3. The dialog deletes; the login page lists the mailbox addresses [04, 11].
4. The export decrypts to every `EXPORT_MAP` table, with no password hash, credential, token or session [05].
5. Find and erase follow D7–D12 and D19; no rescan or backfill stores an erased mail again [06–09].
6. The security log shows the four events (pl, en); docs match the code [10].
7. The VPS runs the migration and the CLIs on a test organization [12].

## Rules for every stage

- Read `CLAUDE.md`, the styleguide, `docs/code-patterns.md`. Build only your stage; format only your files (`bunx prettier --write <files>`).
- D17 in tests: CLI and route tests capture stdout and the log and assert that no test address, organization name or password appears (except the `org:delete` mailbox lines).
- New log lines are events (`platform/log-fields.ts`). Test addresses end in `@x.test`.
- Only stage 01 adds a migration (version later than every file at `HEAD`); only stage 05 changes `bun.lock`.
- `git add <paths>`, never `-A`.

## Proof

Server stages (01–03, 05–09):

```
mkdir -p /tmp/f106-sNN && bun run lint > /tmp/f106-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f106-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f106-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f106-sNN/int.log 2>&1 && echo PROOF_OK
```

Web stages (04, 10): add `&& bun run web:build > /tmp/f106-sNN/web.log 2>&1` before `&& echo PROOF_OK`. Stages 11 and 12: their own.

## Owner steps

No checkpoint. U1 (optional, stage 12): decrypt the VPS test export on the Mac. U2 (any time): turn on `org_delete` where the dialog is wanted.

After stage 01 lands, the coordinator runs `bun run db:migrate` on the shared dev DB.

## Review

Before the land: 01–03, 06–09 (`[risky]`), 05 (all data leaves the server), 04 and 10 (Polish text). Model `claude-opus-5-5`.

## Stages

Files in `stages/`: 01 `stage-01-migration.md` `[risky]`; 02 `stage-02-delete-service.md` `[risky]`; 03 `stage-03-delete-route.md` `[risky]`; 04 `stage-04-delete-dialog.md`; 05 `stage-05-export.md`; 06 `stage-06-address-map.md` `[risky]`; 07 `stage-07-dsr-find.md` `[risky]`; 08 `stage-08-dsr-erase.md` `[risky]`; 09 `stage-09-dsr-outbox.md` `[risky]`; 10 `stage-10-security-log-and-docs.md`; 11 `stage-11-e2e.md`; 12 `stage-12-vps.md` `[risky]` (the coordinator runs it).

## How to run (coordinator)

Order: 01 → 02 → 03 → 04; 05 and 06 after 02; 07 after 05 and 06; 08 → 09; 10 after 03 and 09; 11 after 04 and 10; 12 last. Spawn:

```
limen spawn --engine pi --provider claude-bridge --model claude-sonnet-5-5 --thinking high \
  --extension /home/artek/.pi/agent/npm/node_modules/pi-claude-bridge \
  --prepare 'bash scripts/limen-prepare.sh' --label "<stage title> · F106" \
  'Implement F106 stage NN. Read spec/features/active/F106-e7-t3-account-data-delete-export-dsr/ticket.md, plan.md and stages/stage-NN-<slug>.md; build every step of that stage. Final proof: the Proof command of plan.md for this stage. In the final message, list as proven only what a saved log shows.'
```

Drop the job DB after each land.

## Cold review

Model `claude-opus-5-5`: `[risky]` stages (data delete, privacy, migration). Review 1 ([plan-review-1.md](plan-review-1.md), candidate 33a6f706): FAIL, B1 and 15 notes; answers in [plan-review-1-response.md](plan-review-1-response.md).

Word counts after the fixes: plan 1498; stages 01–12: 697, 555, 636, 697, 697, 699, 593, 698, 616, 671, 387, 586.

## Log

- 2026-11-14: planned.
