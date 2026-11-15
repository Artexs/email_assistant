# F116 stage 05 review (Opus 5.5, PASS c2afc2c4)

Model: Opus 5.5, because the stage is [risky]: an LLM prompt over untrusted mail text. No BLOCKING.

Fixed in one Sonnet continue (no re-review): TG1 (the "10 recipients" test had 7; add 10 and 11 and kill the `>=` mutation), TG2 (a test pins the provider JSON schema), doc drift (`modules.md` 3.14 and the `ExtractorInput` comment: no header address, the body goes as written).

Verified: the nonce marker defense (forged END markers, "ignore previous instructions", nested markers: all removed, one open and one close marker with a per-request 32-hex nonce); a schema-breaking answer (folder, command, `to` keys) gives `schema`; `sentSkipReason` order and edge cases; time zone `friday` -> 17:00 Warsaw; layers and module graph; no file under `evals/` changed; worker mutations 28/29 killed then 29/29.

Notes:
- Body addresses: the stage says "To/Cc count (no addresses)" for the header and lists the body (cut to 8,000 characters, D6) in the same list, so a signature address in the body goes to the model, as in triage. Masking would be a new prompt version (`extractor-v2`): owner decision 49.
- `llm.call` row: the stage text says "the call writes `llm.call`", but `extractSent(llm, input, {timeZone})` has no db. It returns `usage` or `code`. Stage 12 carry-over: write the row (success from `usage`; failure with `llm.modelOf("extractor")`, `llm.endpointOf("extractor")` and the caller's latency), so extractor calls count in the D14 cap.
- Schema looseness: a non-string `ask` or `promise` becomes null instead of a refusal (cleanup runs in `preprocess`); with `expects_reply` false, `ask` may stay non-null (stage 12 opens `waiting` only on `expects_reply`).
- `boss(at)evil.test`, fullwidth `＠` and a bare `evil.test/x` pass the `ask` filter: `ask` is display text only, never a recipient.
- `LONG_DIGITS` allows separators, so a date in an `ask` ("20.11.2026") is cleared: may cost recall in stage 06; the prompt already forbids numbers in `ask`.
- Provider JSON schema uses `oneOf` and `format: date` + `pattern` for `DueRef`: not checked against the real provider; stage 06 shows it first.
- The T2 border lint ran from `triage`; the reviewer reran it from `delegation`: also an error.
