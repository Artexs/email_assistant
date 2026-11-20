# F151 stage 01 — Replay model

Needs: nothing. May run next to 03.

Part of [`../plan.md`](../plan.md). Decisions P3, D2, D3, D11.

## Goal

A loopback test tool (`tools/llm-replay/`) answers the recording's classifier calls with the demo week's own answers. It calls no model; app code never imports it.

## Interfaces (later stages use these names)

- `replayKey(from: string | null, subject: string | null): string` — lower-case trimmed sender address, a newline, the trimmed subject. Stage 02 builds the mail plan with it.
- `type ReplayEntry = { key; answer: ClassifierAnswer; delegateName: string | null }` and `buildReplayTable(seed: DemoSeed): ReplayTable` — one entry per seed mail with a final `triage_results` row. A key with two entries whose answers differ is dropped; the count goes to `table.dropped`.
- `replayAnswer(table, requestBody: unknown): { status: 200; body } | { status: 500; reason: "no_mail_block" | "no_entry" | "delegate_missing" }` — pure.
- `startReplayServer(table, { port?: number }): Promise<{ port; stats(): { hits; misses }; stop() }>` — `Bun.serve` on `127.0.0.1` only; port 0 by default (OS pick). `GET /_replay/stats` answers `{ hits, misses }`.

`ClassifierAnswer` is what the production classifier schema accepts. The server answers only the API path and output form that `platform/llm/providers/openai.ts` uses; any other path is 404 and no miss.

## Decisions

- **Key source.** The server finds the last "The email to classify:" in the user input, then its `From:` and `Subject:` lines. The thread context above it never makes a key. The address inside `From:` may carry a display name: the key takes the address only.
- **Answer.** Category, confidence and reason code come from the newest `triage_results` row of the mail. Other schema fields take their empty value (null, empty list). A seed row of a hard rule (no model) is replayed too, with confidence 1.
- **Delegate.** When the seed answer names a delegate, the entry keeps the delegate's name from the seed `delegates` table. At answer time the server finds the id in the prompt line `- <id>: <name>`. No such line: 500 `delegate_missing`.
- **Seed type.** `parseDemoSeed` of the lab module reads the file; no second parser.
- **Logs.** At most one line per request: path, status, reason code. Never a header, key, subject, address or body.
- **Loopback only.** The server binds `127.0.0.1`; there is no host option.

## Test (`tools/llm-replay/*.test.ts`, bun unit tests in `test:unit`)

1. `replayKey(" Anna <Anna@Firma.test> ", " Invoice 7 ")` → `"anna@firma.test\nInvoice 7"`.
2. A request built with the production `buildUserPrompt` for a mail from `ops@kordelan.test` with subject "Server down" and one thread mail with subject "Lunch" → the entry of "Server down", status 200.
3. The same request with no table entry → 500 `no_entry`; `stats()` gives `{ hits: 0, misses: 1 }`.
4. Two seed mails with the same key, categories `info` and `urgent` → no entry, `dropped` 1. Same key, same answer → one entry, `dropped` 0.
5. A `delegation` answer with delegate "Marta Nowak" and a prompt line `- 0b6e…: Marta Nowak` → the answer carries `0b6e…`. With no such line → 500 `delegate_missing`.
6. Every 200 body parses with the production classifier schema for the allowed categories of the request (`test.each` over `urgent`, `needs_reply`, `info`, `notification`, `spam`, `delegation`).
7. A request with no "The email to classify:" block → 500 `no_mail_block`.
8. A server run: `startReplayServer` with port 0, one POST of test 2 through `fetch`, then `GET /_replay/stats` → `{ hits: 1, misses: 0 }`; `stop()` frees the port.
9. A request that sends `authorization: Bearer sk-test-123`: the captured log lines hold no `sk-test-123`.

Break check: change the key to the first `Subject:` line of the input; test 2 must fail.

## Done when

- Tests 1–9 pass with `bun test tools/llm-replay`.
- `tools/llm-replay` is in the unit test list and the lint scope.
- Proof: last line of `bun run check:job`.

## Out of scope

- Answers for other roles (drafter, extractor, judge). A call of another role is a miss; stage 05 checks that the demo run makes none.
- Server env and start inside the recording (stage 04).
