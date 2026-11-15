# F119 stage 13 review notes (Opus PASS, candidate ed467192)

Review result: PASS, no blocking finding, 1 test gap to close, 1 Polish grammar finding (N1). The follow-up commit closes N1 and TG1.

- N1 (fixed): pl `op_sso_linked` used "członek", a masculine-personal noun: "połączeni członkowie" is wrong for 22–24 and stiff for 2–4, and the genitive form for few would equal many (refused by `i18n.test.ts`). The text is now one "{count} połączona osoba", few "{count} połączone osoby", many "{count} połączonych osób"; en is unchanged. The stage-13 table row has the same text.
- TG1 (fixed): `operator-sso.test.tsx` checks 1, 3, 5, 22 and 12. Reviewer mutations C and C2 (wrong many form, wrong few form) fail it (`/tmp/f119-s13-fix/`).
- N2: the other Polish keys are right (informal "ty", one colon at most, diacritics, en and pl say the same).
- N3: the changed loading-case assertion is not weaker (`toHaveLength(0)` plus a test that no password mark shows). Minor side effect: if the first `/api/me` fails, a password member sees no password form until a 30 s poll succeeds.
- N4: `acct_sso_session` on every SSO session is correct; 43200 s = 12 hours (`SSO_SESSION_SECONDS`).
- N5: the server enforces the password rules: `verifyOwnPassword` (no credential account gives `wrong_password`); "sign out everywhere" needs no password; an owner without a password deletes the organization only through the operator `org:delete`.
- N6: the operator block shows only `domain`, `proof`, `required`, `linkedMembers` and `breakGlassReady`.
- Optional wording ideas, not done: the proof on the domain line; "Set it up or change it with bun run org:sso". Both change stage text word for word and need en and pl tests to change together.
- U1: no axe test covers `/settings` or `/operator`; carry-over added to `stages/stage-14-docs.md`. U2: no browser frames were seen. U3: not traced that `changePassword` and two-factor enable refuse a user without a password (Better Auth asks for the current password).
