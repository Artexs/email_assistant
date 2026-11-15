# F115 stage 01 — Drafter core

Part of [`../plan.md`](../plan.md). `[risky]` (LLM prompt, text to third parties).

The drafter: prompt, output schema, code checks, gaps. No DB, job or draft kind. Stage 02 runs it on the holdout.

## Step 1 — Checks and gaps (core)

- **Goal:** the core names of `interfaces.md` § Core except eligibility and quote, in `packages/core/src/replies/`.
- **Decisions:** ADR 0033 §2–3; PD-073. A string of `allowed` may appear in the body (compare in lower case, spaces collapsed). "Header-like line" = a line that matches `^[A-Za-z-]{2,30}:\s` for the names `From`, `To`, `Cc`, `Bcc`, `Subject`, `Reply-To`, `Date`, `Od`, `Do`, `DW`, `Temat`, `Data`. Phone = 9 or more digits in a run that allows spaces, dashes, dots, brackets and a leading `+`; a run that is a date (`dd.mm.yyyy`, `yyyy-mm-dd`), a time (`hh:mm`), or an amount (decimal comma or point, or a currency word or sign next to it) is cut out first. Account number = an IBAN shape (two letters, then 13–32 letters or digits, spaces allowed) or 13–19 grouped digits (a card). Language: a count of the 30 most common words of each language decides `pl`, `en` or `unknown`; `unknown` passes only under 80 characters.
- **Test (unit, `packages/core/src/replies/checks.test.ts`):**
  1. `"Dzień dobry,\n\nTak, wtorek mi pasuje.\n"` with language `pl` → ok.
  2. Body with `jan@firma.pl` → `address`; the same with `allowed: ["jan@firma.pl"]` → ok.
  3. `https://x.example/a` → `link`; `www.x.example` → `link`.
  4. `+48 600 100 200` → `phone`; `PL61 1090 1014 0000 0712 1981 2874` → `account_number`; `4111 1111 1111 1111` → `account_number`.
  5. Three blank lines in a row → `blank_lines`; two → ok.
  6. A line `Subject: x` → `header_line`; `Temat: x` → `header_line`.
  7. U+202E or U+0007 → `control_chars`.
  8. 2,001 characters → `too_long`.
  9. An English body of 200 characters with language `pl` → `language`.
  10. `[[yes or no for Tuesday]]` → ok, `gapsOf` → `["yes or no for Tuesday"]`; `[[]]` and `[[a [b]]` → `gap_syntax`; `hasGaps("a [[b")` → true.
  11. `normalizeDraftText("a \r\nb\r\n\r\n")` → `"a\nb"`.
  12. `18.11.2026 10:00`, `2026-11-18`, `1 250 000,00 zł` and `$12,500.00` → ok (no `phone`).

## Step 2 — The prompt and the call (server)

- **Goal:** prompt `drafter-v1` in the prompt registry (`triage/prompts/`, replace the `drafter` placeholder) and `draftReply(llm, input) → DrafterResult` in a new module `replies` (add it to `layers.json` layer 3 with the edges of plan D1; regenerate the module graph).
- **Interfaces:** `DrafterInput` = `{ mail: { subject, fromName, fromAddress, receivedAt, body }, style: { displayName, signature, writingStyle }, instruction: string | null, language: "pl" | "en", today, timeZone }`. `DrafterResult` = `{ kind: "draft", body, gaps, usages } | { kind: "no_draft", reason, usages } | { kind: "failed", reason: "checks" | "output", failures, usages }`. `usages` holds one `LlmUsage` per attempt (the caller writes the `llm.call` rows).
- **Decisions:** ADR 0033 §1; PD-072. The mail and its quoted history go in a nonce-marked untrusted block (as `judge-v1` does); the instruction, the style and the signature are marked "from the user". The prompt rubric of notes §3.2: answer every question in order; mirror the form of address, never guess gender from a name, else "Dzień dobry" / "Hello"; short unless the mail is long; never promise, accept, refuse or confirm a date, amount, price or deadline that the instruction or the mail does not give: write a gap. No signature in the body (code adds it). Plain text. One retry after a failed check or an unreadable answer: the retry prompt names the failure codes, never the text. A second failure → `failed`. The mail body goes in at most 8,000 characters.
- **Test (unit, fake LLM client):**
  1. Answer `draft` with a clean body → `draft`, one usage.
  2. First answer has a link, second is clean → `draft`, two usages; the second prompt holds the code `link` and not the link text.
  3. Two answers with `blank_lines` → `failed` / `checks`.
  4. Answer `no_draft` / `needs_facts` → `no_draft`.
  5. Invalid JSON twice → `failed` / `output`.
  6. The nonce markers wrap the mail body; the instruction is outside them.
- **Check:** `bun test packages/core/src/replies apps/server/src/modules/replies`.
- **Done when:** the Proof prints `PROOF_OK`.
- **Out of scope:** DB, jobs, payload kind, eval harness.
