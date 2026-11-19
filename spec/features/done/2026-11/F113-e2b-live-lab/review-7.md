# F113 stage 07 review (Opus): PASS at 757e2bf8, notes and the fixes

Source: job result `2026-11-15-f113-review-s07-opus-injector-ex-b8778f60`, logs in `/tmp/f113-s07-review/`. No blocking finding. Fixes are in the stage 07 branch after the review.

## Test gap

- **TG1** (no second-org test): fixed. Test 9 in `apps/server/test/integration/lab-injector.test.ts` seeds `lab` and `demo` with different addresses, starts the run on `demo`, and asserts 0 mails in every folder of the lab address and 3 in the demo INBOX. Mutation `Object.values(state.readOrgs())[0]?.address` fails it (`/tmp/f113-s07-fix/mut-own4.log`: 14 pass, 1 fail).

## Notes

- **N1** (client host): fixed in stage 07. `createGreenMailClient` throws `LabMailError("host_refused")` for a host that is not loopback; a test covers it. Stage 11 must build the client from `LAB_MAIL_HOST`, `LAB_IMAP_PORT`, `LAB_SMTP_PORT` (`modules/lab/seed.ts`). Carry-over in the stage 11 file.
- **N2** (no lock for one writer): open. `runInjectorTick` reads the events once and holds no lock. Two ticks at the same time can both write `inject_intent` and both send. Stage 11 must take an `O_EXCL` serve (or tick) lock file, so a second `lab serve` cannot double-inject. Carry-over in the stage 11 file.
- **N3** (a stop during a tick): accepted. The `stopped` check runs once at the start of a tick, so a `stopRun` during a tick can let up to 20 more sends go. With one serve process, stage 11 stops between parts, so this cannot happen.
- **N4** (`imap_list` never produced): fixed. The code is removed from `LabMailErrorCode` and from `live-lab.md`; `host_refused` replaces it.
- **N5** (no lint rule for `imapflow`, `mailparser`, `nodemailer`): open. `eslint.config.js` restricts only grammy, gemini, openai and the SSO package; the docs rule in `docs/code-patterns.md` (§ Ports and adapters) is not enforced. Add a `restrictImports` pattern for `imapflow`, `mailparser` and `nodemailer` on `apps/server/src/**` outside `modules/mail/imap/`, `modules/lab/mail-client.ts` and `platform/auth-mail.ts` (tests excluded). Carry-over in the stage 11 file (or the docs stage 16 if stage 11 is full).
- **N6** (docs conflict with master): fixed by the merge of master. `live-lab.md` order: Seed 7, Injector 8, Status 9, Executive rules 10.
