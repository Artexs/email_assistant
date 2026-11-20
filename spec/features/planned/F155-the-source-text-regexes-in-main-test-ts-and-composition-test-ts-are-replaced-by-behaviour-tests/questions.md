# F155 questions

- **Q1 [important: scope]** The owner's G1 answer says "replace the `main.test.ts` and `composition.test.ts` source regexes with behaviour tests". The ticket and the audit rows name six cases; `composition.test.ts` holds about 20 more source pins, and `start/jobs.test.ts` holds two. Default (plan P1): replace only the six. Undo: open a follow-up ticket for the other pins.
- **Q2 [minor]** The job-run half of the release-stamp case becomes an integration test (it needs the DB to write a JSON line; plan D3). Default: integration test in `job-run-cli.test.ts`.
