# F116 stage 12 review (Opus 5.5, PASS e05050f3)

Model: Opus 5.5, because the stage is [risky]: real LLM spend per Sent mail, untrusted text, exactly-once.

No BLOCKING. Probes with a fixed fake client (no real call, nothing sent): hard errors, schema failures and the third attempt end the row `failed` after 3 calls; the cap probes behave as D14 and T9 say; 14 hostile model answers (extra keys to/cc/bcc/folder/command, an address in the ask, a 10 000-char ask, a URL, a past or year-9999 due date) opened no loop with a model-chosen recipient, at most 2 loops, recipients from the Sent row only; no planted value (subject, body, address, ask, key) in any log line or `llm.call` row; lock order: 20 rounds of analysis restart + `setSentSync` off + a committer-like loop lock on real connections gave no deadlock; the worker's 5 mutation survivors are equivalent; the gate evidence needs `errors` = 0; no migration; lint, typecheck, unit 4576, int (the 2 failures were the reviewer's own TMPDIR), graph and docs true.

Fixed in a Sonnet continue (no re-review): TG1 (no test that `lower()` is applied to `s.from_address` in the synthetic-scope query), TG2 (the log test plants `MARKER-KEY` but never passes it to the client: pass `apiKey`), N2 (a soft error on one mail repeats with no limit: one mail that times out every time gets 27 calls a day alone, about 288 a day when another mailbox succeeds, and blocks its mailbox until it is 14 days old: count `timeout` as an attempt), N3 (the cap rounds up: `(used + 1) * 5 > cap * 4`), N1 (the code comment and docs say a Gemini schema rejection is `http_400_schema`: it is a hard `http_400` there: 3 calls then `failed`), N4 (docs: do not run `job:run --name loops.analyze` while the server runs; two processes at once make 2 calls, one row, one set of loops), N8 (docs: an operator's own address in `TEST_SENDER_ADDRESSES` sends all real Sent mail of that mailbox to the model).

Carry-over:
- N1: nothing in code stops the extractor on a Gemini install that rejects the schema (3 calls per mail, at most 240 per mailbox per day at the default cap, then `failed`): check the schema on Gemini before any Gemini install turns on `open_loops`.
- N6 (stages 18 and 19): the loop text can hold markdown and the remains of an escape sequence (`[31m`): the brief and the Telegram cards must escape loop text.
- N9: the T11 child process gets the parent `process.env` with only the two LLM keys replaced; a dev `.env` with `OPENAI_OWN_API_KEY` or `OPENAI_BASE_URL` would pass through: clear every LLM variable in that test.
- N11: the gate file name is `…-lab-01-vsent-v1.json` while the stage text says `sent-v1`.
- N13: `main.ts` (`triageScope`) and `job:run` (`loopsLlmScope`) build the scope in two places.
