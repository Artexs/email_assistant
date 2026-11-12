# Measured core (Stage 2 E3): facts learned in discovery

Written 2026-11-13 by the E3 discovery session. Decisions are in `docs/product/stage-2/epics/E03-measured-core.md` and `decisions.md` (PD-056–PD-069); this note holds facts only.

- Mail sync runs every 5 min (`apps/server/src/main.ts:82`, `*/5 * * * *`). The triage worker and the notifier run every 15 s. The worst-case urgent latency is therefore about 5.5 min.
- The threshold sweep of 2026-11-07 (`evals/results/2026-11-07-gpt-6-luna-classifier-v2.md`) has the same precision from 0.50 to 0.90 in every category. The model reports high confidence on almost every mail.
- The mail mapper keeps only the `From` address, `To`, `Cc`, subject, dates, threading headers and `X-EA-Action-Id` (`apps/server/src/modules/mail/imap/mapper.ts`). It does not keep the display name, `Reply-To`, `Return-Path`, `Authentication-Results`, `List-Unsubscribe`, attachments or link hosts. `simpleParser` already parses the full source for the text, so attachment metadata is available at no extra fetch.
- IMAP flags are fetched with folder metadata (`FolderMessageMeta.flags`) but the `emails` table stores none.
- `outbox` rows of kind `urgent` have `sent_at`; `emails.received_at` is the IMAP INTERNALDATE. Together they give the urgent latency.
- OpenAI prices (pricing page, read 2026-11-13): `gpt-6-luna` $0.10 input, $0.01 cached input, $0.50 output per 1M tokens; `gpt-6.1-terra` $1.00 / $0.05 / $5.00; Batch and Flex 50% off; regional (data residency) processing +10% for models released from 2026-03-05.
- Hetzner CX23 (2 vCPU, 4 GB, 40 GB) costs €5.99 per month with IPv4 (aggregator pikkly.dev, checked 2026-11-10). Hetzner raised cloud prices twice in 2026.
- Not checked yet (E3a stage 1, read-only on the pilot): whether Interia sets `\Answered` on replied mail, and whether it adds `Authentication-Results`; whether a 2-min login rate is throttled.
