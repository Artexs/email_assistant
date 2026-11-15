# F117 stage 10 review (Opus 5.5, PASS b829ddf4)

Model: Opus 5.5, because the stage holds token refresh, locks and rotation. No BLOCKING, no TEST GAP.

Notes for later stages:
1. N4: test 9 alone is timing-dependent against a read-before-lock mutant (it passed under mutant m2). Test 31 is the deterministic guard. Optional: hold the first HTTP call at a gate in test 9.
2. N7 (plausible, low): the SMTP sender reuses the token taken at open. A cache hit can have 5 min left. A long committer batch could then get a 535 and set `auth_error/protocol_disabled` by mistake. A later stage may refresh once in the guard or ask for a longer margin when `withSender` is set.
3. N11 (pre-existing): `POST /mailboxes/:id/password` does not refuse an OAuth mailbox. Stage 11 plans `409 oauth_mailbox`: keep that.
4. N12: no XOAUTH2 test against GreenMail (it takes any token). Stubs are the stronger check; stage 04 covers the real adapters.
5. U1: a crash after the provider answers and before the commit is not tested. The stage accepts it; worst case is one Reconnect.
6. The land of stage 10 needed a merge of master in `composition.test.ts` (add/add): keep both test groups.
