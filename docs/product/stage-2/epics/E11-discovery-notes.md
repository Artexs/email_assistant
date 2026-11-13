# E11 discovery notes (2026-11-13)

> Long detail for the "Discovery (2026-11-13)" section of `E11-contacts-and-context.md`. Session: Stage 2 discovery queue row 10 (`05-execution-plan.md` §3), Opus 5.5, code at `8e446d8`. ADR drafts: `docs/decisions/0034-sender-profiles-from-counts.md`, `docs/decisions/0035-llm-endpoint-eu-and-own-model.md` (both proposed).
>
> Parallel sessions on 2026-11-13: E3 committed (PD-056–PD-069). E5 (draft ADR 0029 read Sent), E6 (draft ADR 0033 reply drafts), E9 (drafts ADR 0031, 0032) and E10 (draft ADR 0030) ran at the same time and were not decided when this was written. This session started as a second E6 session, saw that E6 was claimed, and switched to E11; its E6 facts are in `notes/2026-11-13-reply-drafts-facts.md`.

## 1. Code cross-check (full table)

| Page item | Exists today | Partly | New |
| --- | --- | --- | --- |
| Contacts model | — No `contacts` table (`platform/db/schema.ts`) | `sender_rules` (kind `vip`, `whitelist`, `blocklist`; address or domain pattern; per org or per mailbox; `core/triage/rules.ts`); `delegates` with `competence_tags` set by hand (`delegation/repo.ts`); `triage_results` (category, `vip` per mail); `triage_feedback` (true category, verdict, source) | `sender_profiles`: counts and dates per keyed sender hash (§2) |
| Relation (client, team, vendor, newsletter, unknown) | — | Code knows: VIP, whitelist, blocklist rules; delegates; `isNoreplyAddress`; own-mail check | Relation class by code: `delegate`, `vip`, `known`, `bulk`, `new` (§2.2). No client/vendor label |
| Trust score (old mental model v2, −100…100) | — | — | Dropped: one opaque number; counts with a reason line replace it |
| Competence tags for delegates | `delegates.competence_tags` (manual, CLI; E4-A adds edit in the panel) | Tags reach the classifier prompt (`triage/jobs.ts:97`) | Learning tags: not in Stage 2 (delegate pick 8/8 in the last eval; reopen only if E2a shows delegate-pick misses) |
| Response history | — `emails` stores no IMAP flags | E3a stores flags incl. `\Answered`, `\Flagged`, `\Seen` (PD-068); E5a marks "answered by the user" from Sent and keeps sent-mail metadata (draft ADR 0029) | Profiles count them per sender; reply delays from E5a |
| Sender history in the prompt | — | E3b counts-only hint (PD-062): past labels and corrections per sender, eval-gated | The profile is the same data plus behaviour counts; one table, one shape (§2.4) |
| Suggestions (VIP, blocklist, delegate) | — No suggestion code (`grep -i suggest`: none) | Rules page `apps/web/src/components/rules/` (`AddRuleForm`, `RuleList`) | "Suggestions" card on the Rules page; one line in the E3 weekly report |
| Thread summaries | Per-mail `summary` (classifier, ≤ 600 chars) for `info`; digest lines | — | Dropped from Stage 2 (§4) |
| PII sanitizer | — | `markUntrustedText` masks addresses, links and numbers in LLM output that reaches a draft (not input) | Dropped (§3.3) |
| Local LLM provider | Provider switch `LLM_PROVIDER` = `gemini` or `openai` (ADR 0015); OpenAI adapter uses the Responses API with strict JSON schema (`platform/llm/providers/openai.ts`) | No base-URL setting (`openAiClientOptions(apiKey)` only; no `OPENAI_BASE_URL` in `config.ts`) | `OPENAI_BASE_URL` for the EU endpoint and for an own OpenAI-compatible server (§3) |
| Snooze | — | E5 draft: "Later" on loop lines only | Out of Stage 2 (04 §8: later, small) |
| Per-contact wait (E5) | — | E5 draft: 3 working days, per-mailbox 1–10 | Per-contact wait from the profile (§2.5) |
| Retention and delete of contact data | Retention job clears addresses on `emails` after 90 days (architecture §7); `delete_mailbox` function; DSR plan (PD-038: address map with an `information_schema` test, keyed hash in the audit row) | — | Profiles join the DSR map, export, org and mailbox delete; own 12-month rule (§2.3) |

Page corrections:
- "Built from mail history" conflicts with the 90-day address retention. A table keyed by the plain address would keep every sender's address for as long as the profile lives. The profile uses a keyed hash (§2.3).
- The page dependency "E6 (drafts use the contact context)" is the wrong way round: E6 does not need E11 (E6 draft keeps the drafter context to the thread). E11 needs E5a (Sent marks) and E3a (flags).
- The privacy item does not depend on contacts at all. It depends on E2a (a new model or endpoint must pass the holdout, PD-025) and it touches the frame promise "Mail stays … in the EU" (`03` §2), which is not true today: the pilot runs on OpenAI with "no EU location" (architecture §6.3).

## 2. E11a Sender context: the design

### 2.1 Purpose

One store of "who is this sender to this mailbox", from behaviour, with no mail text. Five readers:
1. The classifier prompt (one line, replaces the E3b hint if it wins on the holdout).
2. Suggestions with a reason (VIP, whitelist, blocklist).
3. The E3b phishing rule `lookalike_domain`: the "domains the user knows" list.
4. The E5 follow-up wait per contact.
5. A sender line in the activity detail and the approval view ("Known: you answered 6 of 8 mails in 90 days").

### 2.2 Data (per mailbox and sender; also per sender domain)

Key: `HMAC-SHA256(org secret, normalized address)` and the same for the domain. Columns (counts are rolling 90 days unless said):
- mails received; per category counts from `triage_results`; corrections per true category from `triage_feedback`; moved back by the user;
- flags on their mail (E3a): answered, flagged, never seen after 7 days;
- user mails to them (E5a Sent metadata): count, last date;
- median user reply delay to them and their reply delay to the user (E5a, both need ≥ 5 samples);
- delegations to them (if a delegate);
- bulk signals seen (`List-Id`, `List-Unsubscribe`, `noreply`, `Auto-Submitted`);
- first seen, last seen.

Relation class (code, in this order): `delegate` (address in `delegates`), `vip` (VIP rule), `bulk` (bulk signals on most mail), `known` (the user answered or wrote to them at least once in 90 days), `new` (first mail in 90 days). No LLM. No client, vendor or team label: the code cannot know it, and nothing in Stage 2 needs it.

### 2.3 Privacy rules

- No mail text, subject, name or display name in the table. The plain address is never stored there. A view joins the address from `emails` (inside its 90-day retention), from `sender_rules` or from `delegates` when it must show one.
- A profile with no mail for 12 months is deleted by the retention job.
- DSR erase (PD-038): the CLI hashes the given address with the org secret and deletes the row; the address map test lists the table. Export (S6c) gives the org owner the profiles with the address where the join finds it. Mailbox and org delete remove them.
- Pseudonymised data stays personal data (GDPR Art. 4(5); Csorba 2026-06-26, §5). The hash limits what a dump or an export shows; it does not make the data anonymous. The records of processing (S6e) list the table.
- Built from the same 30-day pass as the E4-B history check (ADR 0028) at connect; then kept up to date by the triage worker, the flag re-check and the Sent sync. No extra LLM call.

### 2.4 In the classifier prompt

E3b ships a counts-only hint only if it wins on the E2a dev set and passes the holdout (PD-061, PD-062). E11a gives the same line more facts: relation class, "you answered n of m", "you wrote to them n times", corrections. Rule: the profile line replaces the hint only if it beats the hint on the holdout (urgent and needs_reply recall, M8 precision of moving categories). Else the profile stays out of the prompt and serves only §2.1 items 2–5.

Measuring it needs sender history in the eval cases. Today a bank case is one mail with its thread context (E2a notes §2.1). Edit for E2a: each bank case carries the sender's profile (the §2.2 shape, written by the scenario planner from the persona's 90-day story), and the realistic week starts with a 30-day prior history (counts and flags, no text). Without this edit the gain cannot be measured and the profile stays out of the prompt.

### 2.5 Per-contact follow-up wait (for E5)

Wait = 1.5 × the contact's median reply delay to the user, rounded up to working days, bounded 1–7 working days, only with ≥ 5 replies in 90 days. Else the E5 per-mailbox default (3). A date stated in the mail still wins (E5 rule). The brief shows "usual reply time: 2 days" on the loop line.

### 2.6 Suggestions

Each suggestion has a reason line with the counts. The user taps Accept (creates the rule through the existing rule command) or Dismiss (hidden for 90 days). Never automatic. At most 3 new suggestions a week per mailbox, shown on the Rules page card and as one line in the weekly report (PD-066). Rules:

| Suggestion | Rule (defaults) | Never when |
| --- | --- | --- |
| VIP | Person sender; in 30 days the user answered ≥ 5 of their mails and ≥ 60% of them, or flagged ≥ 3 | `bulk`, noreply, already VIP, own address |
| Whitelist | The user moved back or corrected away from `spam`/`notification` ≥ 2 mails of the sender in 90 days | Already whitelisted; phishing flag on any of those mails |
| Blocklist | The user corrected ≥ 2 mails of the sender to `spam` in 90 days and never answered or wrote to them | `known`, `delegate`, VIP, whitelisted; a shared public-provider domain as a domain pattern (only the address) |

Domain-level suggestions only for non-public domains (the existing public-provider list decides; a shared domain proves nothing, `outgoing/sender.ts`).

### 2.7 Sender line

Activity detail and the approval view (E4-A) show one line from the profile: relation class, counts, last mail. Telegram shows it only at the E9 `full` detail level (draft ADR 0032), never content.

## 3. E11b Private model option: the design

### 3.1 The privacy story, in order

1. **EU processing (Must, small).** OpenAI offers European data residency: a project created with region Europe; requests go to a regional domain, are processed in the EEA with zero data retention (OpenAI 2025-02-05). In 2026 a region outside the US needs approval for Modified Abuse Monitoring or ZDR and a Modified Retention amendment; models released on or after 2026-03-05 cost 10% more there (Opsware 2026-10-16, secondary; sovergate 2026-10-26, secondary). Build: `OPENAI_BASE_URL` (default the US API), the price table +10% for the EU domain, docs. Owner step: create an EU project and ask OpenAI for the approval. If OpenAI refuses: Vertex AI in an EU region (planned F076) is the fallback; it needs a third adapter and its own eval.
2. **Own model endpoint (Should).** The same OpenAI adapter, pointed by `OPENAI_BASE_URL` at an OpenAI-compatible server the buyer runs (for example Ollama). Ollama has `/v1/responses` since v0.13.3 (PR 13351, 2025-12-11) and enforces a JSON schema through grammar-constrained decoding (docs.ollama.com, read 2026-11-13). Unknown: whether its Responses path accepts `text.format` with `strict: true` as the adapter sends it; stage 1 checks this, else the adapter gets a chat-completions path with `response_format`.
3. **No PII sanitizer.** Reasons in §3.3.

### 3.2 Proof for an own model

The E2a holdout gate (PD-024, PD-025) runs once with each candidate and publishes the report in `evals/results/`; the E10 security page quotes it. Under ADR 0028 a model that fails the holdout simply unlocks no `auto` category: the product stays safe in shadow and assist with drafts. Candidates: Bielik 11B v3.1 (Polish open model with structured output, released 2026-11-10; vendor claims, no independent replication yet) and one general open model of similar size. Hardware: the home VPS has 4 GB RAM (PD-055) and cannot host a model; the run uses the owner's PC if it has a GPU with ≥ 12 GB memory, else one rented GPU hour on synthetic data only (about $1–2). Performance target in the docs: 200 mails a day = about 600k prompt tokens a day.

### 3.3 Why no PII sanitizer

- It does not answer the buyer's three questions (who holds a copy, is it used for training, where is it processed; 04 §3). The body stays: prices, contracts, health. EU processing and an own model do answer them.
- Detection misses: on held-out synthetic documents the best open tools found 73–89% of names, addresses and organisations; 58–61% of documents leaked at least one value (arXiv 2610.34012, 2026-10).
- Inflection breaks the round trip: in Russian, only 94.6% of name placeholders were restored correctly, mostly wrong surname forms (same paper). Polish declines names the same way ("Kowalski", "Kowalskiego", "Kowalskiemu"); summaries and drafts would show wrong forms.
- It lowers accuracy where it matters: who sends the mail is the strongest urgency signal (aiemaily.com 2026, vendor text).
- Pseudonymised text stays personal data for the holder of the key (GDPR Art. 4(5)); calling it anonymous would be a false claim (Csorba 2026-06-26).

## 4. Moved or dropped from the page

| Item | Verdict | Why |
| --- | --- | --- |
| Thread summaries | Dropped from Stage 2 (Stage 3 with "ask the inbox") | The E5 brief lines use the user's own `ask` text; the E4 approval view shows the quoted thread; E6 drafts read the thread. No Stage 2 surface needs a whole-thread summary, and each update costs an LLM call. Reopen if the E5 pilot shows brief lines that users cannot read |
| Snooze | Out of Stage 2 | E5 gives "Later" on loop lines; snooze of incoming mail stays "later, small" (04 §8) |
| PII sanitizer | Dropped | §3.3 |
| Trust score | Dropped | Opaque; counts with a reason line do the same job |
| Client, vendor, team labels | Dropped | Code cannot know them; no reader needs them |
| LLM competence summaries and learned delegate tags | Not in Stage 2 | Delegate pick passed 8/8; reopen only if E2a shows delegate-pick misses |
| A contacts page | Not in Stage 2 | A list of every sender is a large UI over non-user personal data with no action the Rules page lacks |

## 5. Cross-epic notes (edits for the other pages; the owner approves)

| Page | Edit |
| --- | --- |
| E2a | Bank cases carry the sender profile (§2.2 shape) from the persona story; the realistic week starts with a 30-day prior history (counts and flags, no text). Needed to measure E3b's hint and E11a. Also: one holdout run per own-model candidate (§3.2) |
| E3b | Build the sender-history hint on a minimal `sender_profiles` table in the §2.2 shape (counts from `triage_results` and `triage_feedback`), so E11a extends it and nothing is rebuilt. `lookalike_domain` reads "known domains" from it when E11a lands |
| E3a | The flag store keeps `\Seen` too (for "never seen after 7 days") |
| E4-A | The approval view and the activity detail have room for one sender line |
| E4-B | The history check at connect fills the profiles in the same pass |
| E5 | Per-contact wait (§2.5) replaces the per-mailbox default when the contact has ≥ 5 replies; E5a keeps reply delays per thread so E11a can compute medians. Thread summaries are not an E5 item either |
| E6 | No edit needed: E6 keeps its context to the thread. A later, eval-gated input "relation class and the user's usual greeting form" stays a Stage 3 idea |
| E7 | `sender_profiles` joins the DSR address map (by keyed hash), export, delete tests and the retention job; S6e papers: records of processing list profiles; sub-processor line says "OpenAI, EU region" when §3.1 lands |
| E9 | Graph and Gmail adapters return the same flags (`\Answered`, `\Flagged`, `\Seen` equivalents) |
| E10 | The security-and-data page answers "where processed" with the EU endpoint and lists the own-model option with its holdout numbers |
| `05` §2 graph | `E6 → E11` goes; `E5 → E11` stays (E11a); E11b depends only on E2a and can be planned in wave 2 |

## 6. Research (web, read 2026-11-13; vendor text is marketing)

| Fact | Source, date | Effect |
| --- | --- | --- |
| VIP inferred from behaviour: senders the user opens fast, answers or stars | aiemaily.com docs "Smart tabs & VIP inbox" (vendor) | Behaviour counts are the market's signal; suggestions use answered and flagged |
| Priority from sender trust, communication history, frequency, prior engagement | wysor.io, 2026-01-06 (vendor) | Same signals as §2.2 |
| OpenAI EU data residency: EU project, in-region processing, zero data retention | openai.com "Introducing data residency in Europe", 2025-02-05 | §3.1 |
| Regions outside the US need MAM or ZDR approval and a Modified Retention amendment; +10% for models from 2026-03-05 | opsware.co, 2026-10-16; sovergate.com, 2026-10-26 (secondary) | Owner step; cost +10% (M7 stays far below $5) |
| Ollama `/v1/responses` since v0.13.3; JSON schema enforced by grammar | github.com/ollama/ollama PR 13351 (2025-12-11); docs.ollama.com structured outputs | §3.1 item 2 |
| Bielik 11B v3.1: Polish open LLM, function calling and structured output | bielik.ai blog, 2026-11-10 (vendor); no independent replication (pasqualepillitteri.it, 2026-11-12) | Candidate for the own-model run |
| PII pseudonymisation: held-out recall 73–89%, 58–61% of documents leak; Russian name restore 94.6% (inflection) | arXiv 2610.34012, 2026-10 | §3.3 |
| Pseudonymised data stays personal data for the key holder (Art. 4(5)); redaction is defence in depth, not anonymity | balazscsorba.com, 2026-06-26, updated 2026-09-01 | §2.3, §3.3 |

## 7. Size

| Ticket | Stages | Lines | Content |
| --- | --- | --- | --- |
| E11a Sender context | ≈ 10 | ≈ 2k | Extend `sender_profiles` (keyed hash, columns of §2.2), fill at connect and incrementally, relation class, retention, DSR/export/delete hooks, prompt-line experiment against the E3b hint, suggestions engine and Rules card, weekly-report line, sender line in activity and approvals, per-contact wait for E5, known-domain list for E3b, capability page |
| E11b Private model option | ≈ 5 | ≈ 0.8k | `OPENAI_BASE_URL`, EU price rows, stage 1 check of Ollama's Responses path (or a chat-completions path), holdout runs and result files, install guide for an own model, ADR 0035 accepted |
| **Total** | **≈ 15** | **≈ 2.8k** | Down from 20 / 4k: thread summaries, sanitizer, snooze, trust score and a contacts page leave |

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Profiles are personal data of people who are not users | No text, keyed hash, 12-month deletion, DSR/export/delete coverage, records of processing |
| Suggestions feel like surveillance | Own mailbox only, a reason line with counts, dismiss for 90 days, at most 3 a week |
| The profile helps on the simulator and hurts on real mail | Holdout gate against the hint; history check and tripwire (ADR 0028) still block a category |
| E2a cases carry no sender history, so nothing can be measured | E2a edit (§5); without it the profile stays out of the prompt |
| A wrong blocklist suggestion hides a real person's mail | Never for `known`, delegates, VIP, whitelisted; only after ≥ 2 user corrections to spam |
| The HMAC secret is lost or rotated | Profiles are derived data; rebuild from the 30-day pass and counts |
| OpenAI refuses the EU approval for a small account | Vertex AI EU (F076) fallback; the frame promise stays "planned" on the security page until one works |
| The own model is slow or weak | Published numbers; ADR 0028 keeps `auto` off without a holdout pass; the VPS is not the host (documented hardware need) |
| Ollama's Responses path rejects the strict schema | Stage 1 check; chat-completions path with `response_format` |
| An own endpoint on a private address | Operator config, not user input; the mail host guard does not apply; ADR 0035 says so |
