# E11 · Contacts and context

> Tier: Should (the EU-processing item: Must). Status: decided, second pass after OpenAI answers the EU approval request (PD-104–PD-114; only PD-110 waits; E11a and the rest of E11b are ready to plan in their order). Size: about 15 stages, 2.8k lines, two tickets (E11a Sender context about 10, E11b Private model option about 5). Detail: `E11-discovery-notes.md`; ADR drafts 0034, 0035.

## Outcome

The system knows who each sender is to the user and uses that to find urgent mail, pick delegates and draft better. Threads are summarized as one story, not one mail. The privacy story has a technical answer.

## Users

Executive; the operator (privacy options).

## In scope

- Contacts model (old mental model v2): per sender: relation (client, team, vendor, newsletter, unknown), trust score, competence tags for delegates, response history; built from mail history and user reactions.
- Suggestions that update from reactions: suggest VIP, suggest blocklist, suggest a delegate; the user confirms, never automatic.
- Thread summaries (whole thread, not one mail) for the brief and for the approval context.
- Privacy options: a PII sanitizer before the LLM (names and addresses replaced by tokens, restored after), or a local-LLM provider behind the provider switch (ADR 0015). Pick one by the E2 eval: accuracy loss vs privacy gain.
- Snooze ("show me again Monday") in the brief, if still wanted (small).
- Per-contact wait before a follow-up (E5 default becomes adaptive).

## Out of scope

RAG or vector search unless E2 showed a gain (then its own ticket). CRM integrations. Mail analytics (later, only if wanted).

## Dependencies

E3 (metrics and simulator), E6 (drafts use the contact context). E5 (thread model).

## Open product questions

1. Where the contact page lives: the panel (new page) or only as data behind VIP and delegates.
2. Sanitizer vs local model: which privacy story the product tells first.

## Risks

- A contacts table is personal data of non-users: retention and delete (E7) must cover it from the first migration.
- Suggestions can feel like surveillance; show the reason ("you replied to 12 of 14 mails from this sender").

## Exit

- On the simulator: `urgent` recall improves with contact context against the E3 baseline, or the feature stays off by default.
- VIP suggestions appear in the panel with reasons; the sanitizer or local model passes the eval within the accepted loss.

## Input from the E3 discovery (2026-11-13, PD-062, PD-063)

- E3b may ship a counts-only sender history hint (past labels and corrections per sender); the contacts model replaces it and must beat it on the E2a holdout.
- The look-alike rule of the phishing flag compares against known domains; the contacts model becomes its source of "known senders".

## Discovery (2026-11-13)

Session: discovery queue row 10, Opus 5.5, code at `8e446d8`. Detail, sources and the full design: [E11-discovery-notes.md](E11-discovery-notes.md). ADR drafts: `docs/decisions/0034-sender-profiles-from-counts.md`, `docs/decisions/0035-llm-endpoint-eu-and-own-model.md` (proposed). E5, E6, E9 and E10 ran in parallel; E6 and E9 were decided while this session ran.

### Verdict: modify and split

The page mixes two jobs that share nothing. Each serves the thesis, but on its own path:
1. **E11a Sender context**: one store of "who is this sender to this mailbox", from behaviour counts only (no mail text, no LLM, keyed hash of the address). It feeds the classifier (only if it wins on the holdout), suggestions with a reason, the phishing "known domains", the per-contact follow-up wait and a sender line. Serves "nothing slips" (M1, M2).
2. **E11b Private model option**: makes the frame promise "mail stays … in the EU" (`03` §2) true. Today the pilot runs on OpenAI with no EU location. First an EU endpoint (Must, small), then an own OpenAI-compatible model endpoint with published holdout numbers. Serves "trust and privacy".

Dropped or out of Stage 2: PII sanitizer (misses names, breaks Polish inflection, does not answer the buyer's questions), thread summaries (no Stage 2 surface needs them), snooze (E5 gives "Later" on loop lines), trust score, client/vendor labels, learned delegate tags, a contacts page.

### Code cross-check (summary; full table in the notes §1)

| Item | Exists today | New |
| --- | --- | --- |
| Contacts model | No table; `sender_rules` (VIP, whitelist, blocklist), `delegates.competence_tags` by hand, `triage_results`, `triage_feedback` | `sender_profiles` (counts, dates, keyed hash); E3b may build its minimal form first |
| Response history | No flags stored; E3a adds flags (PD-068); E5a adds Sent marks (draft ADR 0029) | Counted per sender |
| Suggestions | None | Rules page card, weekly-report line |
| Thread summaries | Per-mail summary for `info` | Dropped |
| Local or EU model | Provider switch (ADR 0015); no base-URL setting | `OPENAI_BASE_URL` for the EU endpoint and an own server |
| Contact data deletion | 90-day address retention, DSR plan (PD-038) | Profiles join DSR, export, delete; 12-month rule |

Page corrections: "built from mail history" would keep every sender's address past the 90-day retention, so the key is a keyed hash. The dependency on E6 is the wrong way round (E6 keeps its drafter context to the thread); E11a needs E3a and E5a. The privacy item needs only E2a.

### Cross-epic notes (edits for the other pages; detail in the notes §5)

- E2a: bank cases carry a sender profile and the week starts with 30 days of prior history (counts, no text); without it no sender-history gain can be measured. One holdout run per own-model candidate.
- E3b: build the sender-history hint on a minimal `sender_profiles` table in the E11a shape; `lookalike_domain` reads known domains from it later. E3a: the flag store keeps `\Seen` too.
- E4-A: room for one sender line in the approval view and activity detail. E4-B: the history check fills profiles in the same pass.
- E5: per-contact wait replaces the default with ≥ 5 replies; E5a keeps reply delays. E6: no edit.
- E7: profiles join the DSR map, export, delete tests, retention; S6e papers list them and the EU endpoint. E9: same flags from Graph and Gmail. E10: security page answers "where processed".
- `05` §2: drop `E6 → E11`; E11b can be planned in wave 2 (after E2a).

### Research (sources and dates in the notes §6)

- VIP and priority from behaviour (answered, starred, fast opens, history) is market practice (aiemaily, wysor; vendor text).
- OpenAI EU data residency: in-region processing with zero data retention (OpenAI 2025-02-05); outside the US it needs MAM or ZDR approval and costs +10% for models from 2026-03-05 (secondary sources, 2026-10).
- Ollama serves `/v1/responses` (since v0.13.3) and enforces a JSON schema; Bielik 11B v3.1 (2026-11-10) is a Polish open model with structured output (vendor claims).
- PII pseudonymisation: held-out recall 73–89% on names and addresses; inflection breaks the restore (arXiv 2610.34012, 2026-10). Pseudonymised data stays personal data (GDPR Art. 4(5)).

### Decisions (owner 2026-11-13: "Okay, go with defaults."; rows PD-104–PD-114)

Map: 1 → PD-104, 2 → PD-105, 3 → PD-106, 4 → PD-107, 5 → PD-108, 6 → PD-109, 7 → PD-110, 8 → PD-111, 9 → PD-112, 10 → PD-113, 11 → PD-114.

1. Verdict: modify and split into E11a Sender context and E11b Private model option; drop the sanitizer, thread summaries, snooze, trust score, client/vendor labels, learned delegate tags. [yes]
2. Contacts page: none in Stage 2. Data behind rules and the classifier; a "Suggestions" card on the Rules page; one sender line in the activity detail and the approval view. [no page]
3. Profile content: counts and dates only, no text, no LLM; relation class by code (`delegate`, `vip`, `bulk`, `known`, `new`); key = keyed hash of the address; deleted 12 months after the last mail; covered by DSR, export, delete (ADR 0034). [yes]
4. Profile in the classifier prompt: only if it beats the E3b hint on the E2a holdout; else it stays out of the prompt and serves the other readers. Needs the E2a edit above. [yes]
5. Suggestions: VIP, whitelist, blocklist with a reason line (rules in the notes §2.6); Accept or Dismiss (90 days); at most 3 new a week; never automatic; no delegate suggestions. [yes]
6. Per-contact follow-up wait for E5: 1.5 × the contact's median reply delay, 1–7 working days, only with ≥ 5 replies; else E5's default. [yes]
7. Privacy story: first EU processing (OpenAI EU project by `OPENAI_BASE_URL`, Must tier, because `03` §2 promises it); then an own model endpoint with published holdout numbers; no PII sanitizer (ADR 0035). [yes; second pass after OpenAI answers the EU approval request]
8. Owner step for item 7: create an OpenAI project with region Europe and ask for the ZDR or MAM approval. If OpenAI refuses, Vertex AI EU (F076) is the fallback. [owner does it when E11b is planned]
9. Own-model run: Bielik 11B v3.1 and one general open model; on the owner's PC if it has a GPU with ≥ 12 GB memory, else one rented GPU hour on synthetic data (about $1–2). [rented hour]
10. Order: E11b after E2a (wave 2); E11a after E3a, E5a and E4-B. [yes]
11. Cross-epic edits above: the planning session of each epic applies them; this session edits no other page. [yes]
12. Commit the changed files by explicit path. [yes]

### Corrected size and risks

Size: about 15 stages, 2.8k lines (E11a ≈ 10 / 2k, E11b ≈ 5 / 0.8k), down from 20 / 4k. Risks with mitigations: notes §8 (non-user personal data, surveillance feel, sim-only gain, missing sim history, wrong blocklist suggestion, lost hash secret, EU approval refused, weak own model, Ollama schema path, private endpoint address).

### Planned tickets

| Ticket | Effect |
| --- | --- |
| F076 Vertex AI EU | Not absorbed; stays planned as the fallback of PD-110 if OpenAI refuses the EU approval |
| F072 LLM provider fallback | Not touched (out of Stage 2, PD-067) |

No other planned ticket covers E11 items. `plan-task` runs twice: E11b Private model option (after E2a), then E11a Sender context (after E3a, E5a, E4-B).

### Second pass (trigger: OpenAI answers the EU approval request)

Only PD-110 waits. If OpenAI approves: keep the EU endpoint as the default for every organization except the owner's pilot. If it refuses: E11b adds the Vertex AI EU adapter (F076) and ADR 0035 gets a dated amendment.
