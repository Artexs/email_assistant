# F107 stage 04: terms, DPA, sources and open placeholders

Files: `apps/web/src/legal/{en,pl}/{terms,dpa}.md`. Test: `apps/web/src/lib/legal-terms-dpa.test.ts`. New allowed placeholder: `<organization name>` (`apps/web/src/lib/legal.ts`; the controller of the DPA). New helper `headingTitles` in `apps/web/src/lib/legal-checks.ts` (the privacy test uses it too). Stage 06 builds `docs/legal/claims.md` from the tables below and from `notes/2026-11-17-f107-s03-privacy-sources.md`.

## Open placeholders

- Terms (each language): `<provider name>`, `<contact>`, `<address>` (P3), `<to confirm: liability>`, `<to confirm: governing law>`.
- DPA (each language): `<provider name>`, `<address>`, `<contact>`, `<organization name>`, `<to confirm: staff>`, `<to confirm: objection period>`, `<to confirm: audit rights>`, `<backup retention>` (same fact as privacy section 4).
- Annex 2 of the DPA is the generated table: its open registry placeholders are in the stage 03 note.

## Terms: statement and source

| Statement (short) | Source |
| --- | --- |
| Functions: sort, reason, summaries, delegate, spam filter, drafts | `docs/product-brief.md`, `docs/capabilities/triage.md`, `docs/capabilities/drafts-and-send.md` What it does now |
| Private server for its owner only | The draft line (P1, plan; owner text of P21) |
| Draft leaves only after an owner approves | `docs/capabilities/drafts-and-send.md` What it does now |
| No sign-up; operator makes organization and first owner; roles owner and assistant | `docs/capabilities/tenancy-and-plans.md` What it does now, rules 1 and 7 |
| Setup link works once; terms accepted and password set there | `docs/capabilities/web-panel.md` rule 5 and rule 4 (Terms) |
| Password 12 to 128 characters; leak check | `docs/capabilities/web-panel.md` What it does now and rule 4 |
| Lockout 10 in 15 min for 15 min | `docs/capabilities/web-panel.md` rule 4; `docs/architecture.md` §7 |
| Optional TOTP; company sign-in if the operator set it up | `docs/capabilities/web-panel.md` rule 4 |
| Session up to 30 days; end all or all other sessions in the Account card | `docs/capabilities/web-panel.md` rule 3 and rule 4 (Session list) |
| Plan states; the operator changes them; a trial that ends changes nothing | `docs/capabilities/tenancy-and-plans.md` rule 3, Limits |
| Mailbox limit set by the operator | `docs/capabilities/tenancy-and-plans.md` rule 3 (Mailbox limit), rule 7 |
| Suspended: jobs stop, Telegram answers "account paused", resume skips mail more than 24 h before | `docs/capabilities/tenancy-and-plans.md` rule 3 (Jobs, Telegram, Resume) |
| Suspended: reads work; accept terms, language, delete still allowed | `docs/capabilities/tenancy-and-plans.md` rule 3 (Web, `SUSPENDED_WRITE_ALLOW`) |
| No price, no payment | `docs/capabilities/tenancy-and-plans.md` Limits (no billing; PD-047) |
| Mailbox secret encrypted; app password advice | ADR 0009; `docs/architecture.md` §7; same wording as the privacy policy |
| Shadow mode changes nothing; assist applies allowed actions | `docs/architecture.md` §4.3 modes table |
| Assist: move, flag, mark read, drafts; only auto categories that passed the gate | `docs/capabilities/actions-and-undo.md` rule 2; `docs/capabilities/drafts-and-send.md` |
| Send needs an owner tap; ends after 48 h | `docs/capabilities/drafts-and-send.md` What it does now |
| Never deletes mail in the mailbox; drafts and folders stay after delete | `docs/capabilities/account-data.md` Limits (PD-039) |
| Undo for 7 days for each applied move, flag, mark read | `docs/capabilities/actions-and-undo.md` What it does now and rule 7 |
| Feedback buttons mark a result as wrong | `docs/capabilities/actions-and-undo.md`, `docs/capabilities/triage.md` (feedback) |
| One backup each night | `docs/capabilities/backups.md` rule 1 |
| Panel only on the private network (Tailscale) | ADR 0017. Weak: true for the home VPS install only (same as privacy). |
| Delete by the owner (flag `org_delete`) or the operator; what goes; backups keep rows; restore needs a repeat; change mailbox passwords | `docs/capabilities/account-data.md` rules 1, 3, 4, 15 |
| Export by the operator, encrypted, no hash, secret, token, session | `docs/capabilities/account-data.md` rule 6 |
| New version shows a dialog; acceptance records version and time | `docs/architecture.md` §7 Terms; `docs/capabilities/web-panel.md` rule 4 |

## DPA: statement and source

| Statement (short) | Source |
| --- | --- |
| Controller is the organization; processor is the service | `docs/product/stage-2/epics/E07-discovery-notes.md` §4 (W13, D19 of the S6 plan). Weak: a plan decision, not a law text. |
| Subject, duration, nature and purpose (triage, actions, drafts, digests, delegation follow-up) | Stage 04 file; the purposes of the privacy policy (stage 03 note) |
| Data categories and subjects point to the privacy table | `packages/core/src/legal/data-categories.ts` (the table is generated) |
| Instructions: panel settings and the written request of the owner | `deploy/README.md` § Data request ("only on the written instruction of the owner"); `docs/capabilities/account-data.md` |
| Only the operator has access; members see only their organization | Stage 04 file only. Weak: no doc states that the operator is the only person with access; the operator console shows ids, codes, counts and dates (`docs/capabilities/tenancy-and-plans.md` Limits). Staff: placeholder. |
| Annex 1 measures (AES-256-GCM, TLS, Tailscale, `age`, lockout, leak check, TOTP, tenant filter, row-level security, logs) | The stage 03 note rows for section 8 of privacy (`docs/architecture.md` §5, §6.1, §7; ADR 0009, 0017; `docs/capabilities/backups.md`). Weak: row-level security: `tenancy-and-plans.md` rule 2 says "there is no row-level security" and `architecture.md` §5 says there is (F092); the privacy text and this text follow the architecture. Panel only through Tailscale: home VPS only. |
| General written authorisation; Annex 2 table; new row changes the version | Authorisation: stage 04 file (Art. 28(2) not checked; stage 06). The version change: plan D5, built in stage 06. Weak until stage 06 adds the guard. |
| Processor tells the controller of a request and does not answer it | W13 (E07 notes §3, EU SCC for Art. 28, 2021/915). The clause text is quoted in the notes; not re-read here. |
| Find and erase on the written instruction; tell the controller what was found | `docs/capabilities/account-data.md` rules 7 to 13; E07 notes §4 ("a JSON file for the controller") |
| Controller answers in one month (Art. 12(3)) | `deploy/README.md` § Data request. The article is not checked (stage 06). |
| Breaches: tell the controller without undue delay; own breach procedure | Stage 04 file. Weak: the procedure does not exist before stage 05; the wording "without undue delay" is from the stage file, not from a checked law text (stage 06). |
| End: delete removes data at once; export on request first; backups expire by their rule (7 days local, `<backup retention>` off-site); mailbox keeps mail, drafts and folders stay | `docs/capabilities/account-data.md` rules 3, 4, 6, 15 and Limits; `docs/capabilities/backups.md`; `deploy/backup.env.example` |

## Statements with a weak source (for the final message and stage 06)

1. Roles controller and processor (a plan decision).
2. "Only the operator has access" (no doc).
3. Row-level security (the capability page and the architecture disagree).
4. Panel only through Tailscale (home VPS only).
5. "Without undue delay" and "general written authorisation" (law text not read).
6. "The version changes with a new row" (guard comes in stage 06).
7. The breach procedure (stage 05 writes it).
8. "No service level" in the terms (a product choice that no doc states; no doc promises uptime).
9. "AI can be wrong": general statement; the feedback buttons are the only code source.

## Judgement calls and questions

- The Polish mode name in the terms is "tryb asystenta" (UI key `mb_mode_assist`). The privacy text says "tryb asysty". Stage 06 may align them (a privacy text change is a question, not part of this stage).
- The DPA says nothing about the duties of the processor towards sub-processors, assistance with the DPIA (Art. 28(3)(f)), or proof of compliance beyond the audit placeholder: the stage lists no section for them. Stage 06 decides whether to add them.
- `<organization name>` is a new placeholder. Another option was `<to confirm: controller name>`. A real placeholder keeps the controller line free of a "to confirm" note and a test lists it.
- The stage-04 TERMS_VERSION test of the stage file (test 3) is the one in `legal-privacy.test.ts`; this stage adds no second copy.
