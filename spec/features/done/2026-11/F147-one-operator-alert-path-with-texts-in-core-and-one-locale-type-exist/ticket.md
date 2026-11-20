---
opened: 2026-11-19
landed: 2026-11-20
---

# F147 · One operator alert path with texts in core and one locale type exist

## Outcome

Every message to the operator chat goes through one path in the operator module: one kind list, one send rule, one set of log lines and one test command, with every operator text in core in English and Polish. The five event notices (trial end, mailbox login error, LLM cap, failed auth mail, send limit) and the five service-level alerts keep their exact words, keys and timing. The product has one locale type for every text it shows, so a third language is one edit and the lint finds a copy.

## Scope

- Starting seams: the event notices in the channels module (`createOperatorNotices`) and the service-level alerts in the operator module (`runSloTick`, `slo-texts.ts`); quality pass 2, finding 8.
- The service-level alert words and their renderer move to core next to the event texts.
- The event notices move to the operator module and use the same delivery and log lines as the alerts.
- `ops:alert-test` shows all ten kinds.
- Every product-text locale copy (docs, web, operator, config, push payload) becomes the core `UserLocale`; a lint rule bans a new copy.

## Out of scope

- A change of an alert text, a dedup key, a schedule, a threshold or a repeat rule.
- Moving the event dedup out of the organization's audit log (`plan.md` D1).
- The language of a mail or a draft (`"pl" | "en" | "other"`): another concept.
- The operator console notice list.

## Acceptance

- `apps/server/src/modules/operator/slo-texts.ts` and `channels/operator.ts` are gone; `packages/core/src/texts/operator.ts` holds every operator text.
- The moved text tests pass with the same expected strings, and the moved notice integration tests pass with the same keys.
- No log line named `operator_notice*`, `slo_alert_*` or `slo_check_failed` remains in `apps/server/src` (search finds nothing).
- `bun run ops:alert-test --all` prints ten `sent` or `unsent` lines.
- `bun run lint` fails on a new `"en" | "pl"` union, `as const` list or `z.enum` of those two in a product-text file.

## Slices

Four stages: 01 and 02 in parallel; 03 after 01; 04 after 03. No migration, no `bun.lock` change. Detail: `plan.md` § Stages.

## Sequenced

Plan after: none.
Build after: none. Gate: none. File overlaps are advisory (the split of the server start-up into `start/*.ts`, F143 stage 12; the command-line tool standard, F129; other tickets that add lint rules): on a land conflict, merge master and re-prove.

## Notes

Source: `spec/quality/2026-11-20-pass-2.md` finding 8. Defaults: `questions.md`. Scouts: `scouts.md`.
