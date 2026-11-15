# F119 stage 11 review notes (Opus PASS, candidate e7dc93a7)

Review result: PASS, no blocking finding, 2 test gaps (both fixed in the follow-up commit: TG1 header-independence in test 5 of `web-sign-in-options.test.ts`, killed mutation o1; TG2 `POST` without a session expects 401, with a trusted `Origin` header because a bare `POST` stops at the origin check with 403).

- N2: the bit "some organization on this install has SSO" is public by design (D13, D14, Q6). It names no organization, domain or count.
- N3: the code comment "one indexed read" was wrong. Fixed: a small read of `sso_providers` (a seq scan at this size) joined to `org_features` by key.
- N4: no rate limit, by decision. The route takes no input and costs one small read, the same class as `/health`. If a limit is wanted later, cache the bit in the process for 5–10 s; that changes tests that flip rows between requests.
- N6: a suspended organization that holds the only SSO provider still makes the bit true, so the button shows and the callback then refuses the sign-in. The plan does not ask for a suspended check. Note for the stage 14 docs and the stage 15 VPS checks.
- N9 (optional): `sec_kind_sso_required_changed` could read "Zmieniono ustawienie „Wymagane SSO”" to match `op_sso_required` of stage 13. Left as it is: `op_sso_required` does not exist yet, and the en text and the tests state "Zmieniono wymóg SSO". Stage 13 can align both languages and the test in one change if it wants one wording.
