# F151 stage 01 — Replay model

Needs: nothing. May run next to 03.

Part of [`../plan.md`](../plan.md). Decisions P3, D2, D3, D11.

## Goal

A loopback test tool (`tools/llm-replay/`) answers the recording's classifier calls with the demo week's own answers. It calls no model; app code never imports it.

## Interfaces (later stages use these names)

- `replayKey(from: string | null, subject: string | null): string` — lower-case trimmed address, a newline, the trimmed subject.
- `type ReplayEntry = { key; answer: ClassifierAnswer; delegateName: string | null }` and `buildReplayTable(seed: DemoSeed): ReplayTable` — one entry per seed mail with a `triage_results` row; a key with two different answers is dropped (`table.dropped`).
- `replayAnswer(table, requestBody: unknown): { status: 200; body } | { status: 500; reason: "no_mail_block" | "no_entry" | "delegate_missing" }` — pure.
- `startReplayServer(table, { port?: number }): Promise<{ port; stats(): { hits; misses }; stop() }>` — `Bun.serve` on `127.0.0.1`, port 0 (OS pick) by default; `GET /_replay/stats` answers `{ hits, misses }`.

`ClassifierAnswer` is what the production classifier schema accepts. The server answers only the API path and output form that `platform/llm/providers/openai.ts` uses; any other path is 404 and no miss.

## Decisions

- **Key source.** The `From:` and `Subject:` lines after the last "The email to classify:" of the user input; never the thread context. A display name in `From:` is ignored.
- **Answer.** Category, confidence, reason code, reason, summary and `fields` (task, clarification, due date, language) come from the newest `triage_results` row of the mail (both exported): `planDelegation` needs `task`, and the urgent notice shows the reason. A field that the row lacks takes the schema's null; `language` falls back to the seed row's language, else `other`.
- **Rule rows.** A row whose reason code is not one of the classifier's reason codes (a hard rule, `triage_error`, `llm_blocked`) gives no entry; `table.ruleRows` counts them. Stage 02 never picks such a mail.
- **Delegate.** The entry keeps the delegate's name from the seed `delegates` table. At answer time the server finds the id in the prompt line `- <id>: <name>` or `- <id>: <name> (<tags>)`. No such line: 500 `delegate_missing`.
- **Seed type.** `parseDemoSeed` of the lab module reads the file; no second parser.
- **Logs.** At most one line per request: path, status, reason code. Never a header, key, subject, address or body.
- **Loopback only.** The server binds `127.0.0.1`; there is no host option.

## Test (`tools/llm-replay/*.test.ts`, bun unit tests in `test:unit`)

1. `replayKey(" Anna <Anna@Firma.test> ", " Invoice 7 ")` → `"anna@firma.test\nInvoice 7"`.
2. A request built with the production `buildUserPrompt` for a mail from `ops@kordelan.test` with subject "Server down" and one thread mail with subject "Lunch" → the entry of "Server down", status 200.
3. The same request with no table entry → 500 `no_entry`; `stats()` gives `{ hits: 0, misses: 1 }`.
4. Two seed mails with the same key, categories `info` and `urgent` → no entry, `dropped` 1. Same key, same answer → one entry, `dropped` 0.
5. A `delegation` row with delegate "Marta Nowak" and task "Send the Q3 report" (`test.each` over the prompt lines `- 0b6e…: Marta Nowak` and `- 0b6e…: Marta Nowak (finance)`) → the answer carries `0b6e…` and `fields.task` "Send the Q3 report". With no such line → 500 `delegate_missing`.
5a. An `urgent` row with reason "Server outage since 9:00" → the answer's `reason` is that text.
5b. A row with reason code `blocklist` → no entry; `ruleRows` 1.
6. Every 200 body parses with the production classifier schema (`test.each` over `urgent`, `needs_reply`, `info`, `notification`, `spam`, `delegation`).
7. A request with no "The email to classify:" block → 500 `no_mail_block`.
8. `startReplayServer` (port 0), one `fetch` POST of test 2, then `GET /_replay/stats` → `{ hits: 1, misses: 0 }`.
9. A request with `authorization: Bearer sk-test-123`: no log line holds `sk-test-123`.

Break check: key on the first `Subject:` line; test 2 fails.

## Done when

- Tests 1–9 pass with `bun test tools/llm-replay`.
- `tools/llm-replay` is in `test:unit` and lint.
- Proof: last line of `bun run check:job`.

## Out of scope

- Answers for other roles (a call of another role is a miss). Server env and start (stage 04).
