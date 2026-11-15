# F103 stage 12 review notes

Sonnet review of `4cd8c5fa`: PASS with test gaps. Report: `/tmp/coord/f103s12-review.txt` (may be deleted). The gaps are fixed in the follow-up commits.

- **TG1** The new capture tests read the filtered console output, so a URL put in a field would be dropped without a trace. Each capture test (web-http "web root events", the retention log tests, the testmail-remote bundle test, the new send and composition tests) now also asserts that `dropped_fields` is absent. The `captureLines` comment is fixed. Mutation: `host: baseUrl.origin` in `web_on` fails the web-http test (`/tmp/f103-s12/mut4-web-on-dropped.log`).
- **TG2** New tests: `testmail_sent`, `testmail_send_failed`, `testmail_wait` (429 and network), `testmail_recovered`, `testmail_stopped` (`send.test.ts`, "log events"); `retention_failed` (`retention-job.test.ts`); the six `actions_scope` / `send_scope` calls (new `src/composition.test.ts`). One mutation per group, each fails its tests: `mut5-testmail-batch.log`, `mut6-retention-failed.log`, `mut7-scope.log`.
- **TG2, main-start-log** `main-start-log.test.ts` spawns the server with the web off, so it cannot see `web_on`. A web-on spawn needs a database and a web build. `web-http.test.ts` covers `web_on` instead. Left as is.
- **N1** `docs/capabilities/retention.md` (lines 11, 37) and `web-panel.md` (line 11) now use the new event codes.
- **N2** The stage text now says eleven `*_rows` counts.
- **N3** `deploy/README.md` step 4 greps `web_|auth_mail`; it also matches `web_operators`. True and harmless; no change.
