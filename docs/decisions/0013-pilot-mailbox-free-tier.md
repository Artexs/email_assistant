# 0013 — LLM: the temporary pilot mailbox on the Gemini free tier

- Status: accepted (user, 2026-11-04); amended by 0015 (second provider OpenAI behind LLM_PROVIDER, 2026-11-06)
- Date: 2026-11-04
- Amends: 0007, 0012

## Context

ADR 0007 and 0012 require Cloud Billing before real mail reaches the LLM. The user has one Interia account.
It is temporary and holds nothing important. On 2026-11-04 the Flash-Lite models answered on the free tier in about 1 s
(`gemini-3.5-flash-lite` 837 ms). `gemini-3.8-flash` gave 503.

## Decision

1. The temporary pilot Interia mailbox counts as test mail. Its real mail may go to the Gemini API free tier.
   User, 2026-11-04: "A mail is just a real one but temporary, it just contains some emails but there is nothing important, we can treat it like test email, and we will use Gemini free tier for now."
2. This is for this one mailbox only. Cloud Billing (Gemini API paid tier), or Vertex AI as in ADR 0012, stays required
   before the mail of any other person, and before a mailbox of the user that is not temporary.
3. `TRIAGE_LLM_SCOPE` (`off` | `synthetic` | `all`, default `off`) is the safety switch. With `all`, the worker triages only
   the mailbox whose address equals `TEST_MAILBOX_ADDRESS`, until a paid-tier key exists. `synthetic` is not a security boundary:
   it picks mail by the Message-ID suffix `@ea-seed.test>`, and any sender can write such a Message-ID. Use `synthetic` only on a test mailbox.
4. The Cloud Billing budget alert waits until billing is on (`spec/features/planned/F023-gemini-billing-budget-alert/plan.md`).
   The in-app daily cap `LLM_DAILY_CAP` (default 300) stays.
5. Start value of the classifier model: `gemini-3.5-flash-lite`. The S1b eval result goes to `docs/architecture.md` §6.3
   and the S1b task file, not into this ADR.
6. Simple LLM calls. User, 2026-11-04: "just make a call to the LLM and don't complicate it with additional parameters like temperature".
   `platform/llm.ts` sends only the model, the system instruction, the prompt, the JSON response type and schema, and the abort signal.
   It sends no temperature and no thinking setting. Each model uses its default thinking.
   `gemini-3.5-flash-lite` defaults to "minimal" (https://ai.google.dev/gemini-api/docs/thinking, read 2026-11-04),
   so the default classifier meets the ADR 0012 rule "`classify` uses the lowest thinking setting".
   `gemini-3.8-flash` (comparison only) uses its default ("medium"). ADR 0012 stays unchanged.

## Consequences

The user accepted these points after the plan review (2026-11-04).
Source for the terms: https://ai.google.dev/gemini-api/terms ("Gemini API Additional Terms of Service", effective 2026-03-23, read 2026-11-04).

- **Free-tier terms ("Unpaid Services"):** Google may use the submitted mail text and the responses to provide, improve and develop
  its products and machine learning technologies (training). Human reviewers may read, annotate and process the input and output.
  Google disconnects the data from the Google Account, API key and Cloud project before review.
- **Third-party content:** the pilot mailbox holds mail from third-party senders (their names, addresses and text: personal data of other persons).
  The user accepts human review and use for training of this content, for the temporary pilot mailbox only (user, 2026-11-04).
- **Personal data (user answer Q26, 2026-11-04):** the user accepts that the pilot sends third-party personal data to the Unpaid Services,
  against this line of the terms: "Do not submit sensitive, confidential, or personal information to the Unpaid Services."
  Source: https://ai.google.dev/gemini-api/terms ("Gemini API Additional Terms of Service", effective 2026-03-23, read 2026-11-04).
- **EEA / Switzerland / UK rule:** "If you're in the European Economic Area, Switzerland, or the United Kingdom", the paid-tier data terms
  apply to the unpaid quota too (no use to improve products; processing under the Data Processing Addendum; logging for a limited period
  only for abuse checks and legal disclosures). [not verified: how Google decides that "you're in" the EEA: account, project, billing country
  or request origin.] This ADR does not rely on that rule: the user accepts the worst case above.
- **Use restriction:** "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom."
  This does not block the pilot: the app is not made available to any user. Only the developer (the user) uses it, on the developer's own mailbox.
  The rule applies before the first other user: then Paid Services, or Vertex AI as in ADR 0012.
  [Reading of the terms, not legal advice; not verified with Google.]
- **Quota:** the free-tier daily request quota is per project and shared by the worker and the eval runner. 429 is a soft error (ADR 0012).
- **End of this ADR:** when Cloud Billing goes on for the project, this ADR ends for that project
  (`spec/features/planned/F023-gemini-billing-budget-alert/plan.md` sets the docs back to the paid tier).
