# F113 stage 13 review (Sonnet 5.5, PASS d26d01fe)

Model: Sonnet 5.5, because the stage is read-only scoring with org-scoped queries, no send path and no migration. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (mutation t10 is not equivalent: email ids are caller input, so a cross-org call test for `listDelegationOutcomes` is needed; t11 is equivalent because of the `emails.org_id` join) and TG2 (a test where the newest of two delegations on one mail wins).

Verified: every new query filters `org_id`; hand recompute of the fixtures (test 5 due 2, closed 1, surfaced 1; test 6 cost $0.0006 per week, $0.407571 per month; world test limits 3 with 1 held, expired 2, phishing 3 injected, 2 noticed, 1 warned); no NaN path (`share()` n/a on 0, `usdPerMail` null on 0 mails, p90 null); the five renderers hold no subject, body, address, ask or promise text; `live-lab.md` 22.8-22.15 match the code; `lab -> reports` and `lab -> delegation` edges are allowed (`lab` is the top layer); 36 of 38 worker mutations killed.

Notes:
- `listExpiredUnapprovedSends` excludes only `delegation_closed`: a send closed by `send_closed` or `superseded` with no tap also counts as "expired without a tap". The report lists them by reason code, so it is visible. The lab never uses the edit flow.
- A reject with a reason counts as two presses (`reject_*` and `reason_pick`); `pressed` is not "cards decided". The table shows both rows.
- There is no direct test that every key of `sections` has a renderer; the headings test covers the five new ones. Add one in stage 16 if cheap.
- The reviewer's first int run failed 18 tests because the job DB lacked master's migration `20261115150001`: environment, not a defect.
