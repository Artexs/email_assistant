# F147 plan — one operator alert path, texts in core, one locale type

> **Status 2026-11-20 — planned.** Plan base: 22188c54. No stage built.

## Input

Owner words (quality pass 2, `spec/quality/2026-11-20-pass-2.md` finding 8, fix): "Short step: replace the three locale unions by `UserLocale`. Ticket line: "One operator alert path: the five hourly operator notices become kinds of the `ops_alerts` mechanism, and the alert texts move to `packages/core/src/texts/operator.ts`"."

### Decisions taken

- **D1 One mechanism, two state stores** (default, owner to confirm; `questions.md` Q1). One kind list with a lifecycle per kind: `incident` (the five `slo_*` kinds: open, repeat, resolve; state in `ops_alerts`, host-wide) and `once` (the five event kinds: one text per key; state stays the audit row `operator.notice` in the organization of the event). Both lifecycles share the kind list, the texts, the delivery, the log lines and the test command. Reason: `ops_alerts` has no `org_id` and holds no ids by an owner rule exception (2026-11-15); event keys hold organization, mailbox and user ids, and the audit row already goes with the organization delete and sits in the export and erase maps. Rejected: event rows in `ops_alerts` (an `org_id` column or ids in a host table, new privacy-map entries, and a data copy migration of the old keys).
- **D2 Texts in core, same words.** Every operator text lives in `packages/core/src/texts/operator.ts` (en, pl). The renderers live in `packages/core/src/ops/alert-text.ts`. No text changes: the moved tests keep their expected strings.
- **D3 Event facts and keys in core.** `OperatorEvent` (a union by kind) and `operatorEventKey(event)` live in core. The key is byte-identical to `HEAD`: a changed key sends every past notice again.
- **D4 Module.** The event notices move from `channels` to `operator` (`operator/notices.ts`). The layer order allows it (`operator` is above `channels`, `actions`, `audit`, `mail`, `tenancy`). The callers get the notices as hooks from the composition roots, as now.
- **D5 Schedules stay.** `channels.operator` (hourly, minute 13) and `ops.slo` (every 5 min) keep their names, times and run order. Rejected: one job (changes timing and the job list that `start/jobs.test.ts` pins).
- **D6 One delivery.** `deliverOperatorText` (stage 04) sends one text. No operator chat counts as delivered for both lifecycles (as at `HEAD`). A failed send returns false and writes no mark.
- **D7 One log vocabulary** (default; Q2): `operator_alert_sent` (info), `operator_alert_unsent` (warn, no chat), `operator_alert_send_failed` (error, once per alert key per process), `operator_alert_failed` (error, state read or write), `operator_check_failed` (warn, a check or detector threw). Fields: `kind`, `status` (`open`, `repeat`, `resolved`), and error fields only. The names `operator_notice_*`, `operator_notices_failed`, `slo_alert_*` and `slo_check_failed` go.
- **D8 Retry rules stay.** Incident: next tick from `ops_alerts`. Event: `trial_ending`, `auth_error_24h` and `send_limit` are found again by the hourly run; failed `llm_cap` and `send_limit` sends retry from memory at the next hourly run; `auth_mail_failed` is not retried.
- **D9 Test command for all kinds** (default; Q3). `ops:alert-test --kind <any of 10>` or `--all` (incident kinds in `SLO_KINDS` order, then event kinds in `OPERATOR_EVENT_KINDS` order). An event test text is the line `TEST <kind>`, then the event text of a fixed sample event. It writes no audit row and no `ops_alerts` row.
- **D10 One locale type.** `UserLocale`, `userLocales` and `userLocaleSchema` (`packages/core/src/tenancy.ts`) are the language of every text the product shows: docs, web, operator texts, `OPERATOR_LOCALE`, the push payload `lang`. The language of a mail, a draft or a sim slot (it may hold `other` or `de`) is another concept and keeps its types. Rejected: one type for both (a new interface language would then claim draft support).
- **D11 Ordered lists.** A list that equals `userLocales` in order becomes `userLocales`. A list in another order (for example the screenshot order) stays, typed `readonly UserLocale[]`.
- **D12 Guard.** A local lint rule `ea/no-locale-union` fails on a union of exactly the literal types `"en"` and `"pl"` and on `z.enum` of exactly those two strings. It covers non-test code of `apps/docs/src`, `apps/web/src`, `apps/server/src` and `packages/core/src`, except the mail-language folders that stage 02 lists.
- **D13 Locale is required.** `createOperatorNotices`, `runSloTick` and `sendTestAlerts` take `locale: UserLocale` with no default; `OPERATOR_LOCALE` (default `en`) is the one default.

Edge cases (plan-task §4), answered by the decisions: a crash between send and mark repeats one text for both lifecycles (D6, D8); a restart keeps incident state and event dedup in the DB and loses only the in-memory retries (as at `HEAD`); a suspended organization gets no `trial_ending`, `auth_error_24h` or `send_limit` text (unchanged); two server processes are not supported (unchanged). Texts hold ids, codes, counts and dates only; a log line never holds the text, the chat id or the Telegram description.

## Facts checked

- Layers: `channels` is layer 4, `operator` layer 5; `operator` already imports `channels` (scout 1, `layers.json`, read 2026-11-20).
- `ops_alerts` has a SQL CHECK of the five `slo_*` kinds, no `org_id`, no retention (migration `20261115140001_ops_alerts.sql`, read).
- Event keys and texts: `channels/operator.ts` and `texts/operator.test.ts` (read). Fixed key values in stage 01 computed with `bun -e`.
- `apps/docs` depends on `@ea/core`; root `bun run typecheck` runs `astro check` for docs; `eslint .` lints `.astro` files of web and docs (`eslint.config.js`, read).
- `telegramErrorFields` is not exported from the `channels` index (stage 03 exports it).

## Not verified

- That the astro ESLint parser exposes a `Props` union to a local rule. Stage 02 checks it with a mutation; if it does not, the stage reports it and the rule covers `.ts` and `.tsx` only.

## Done when

`ticket.md` § Acceptance (5 items).

## Rules for every stage

- Words, keys, schedules and thresholds do not change. A test whose expected string or key must change is a stop: report it.
- A gap in a decision, or a deviation, is a question in the final message.
- Format only the files of the stage. Probes go to `/tmp/f147-sNN/`.
- A stage that adds or removes an import between modules runs `bun run graph:modules` and commits its output.
- Update the capability page of the behaviour in the same stage (PD-009).

## Proof

`mkdir -p /tmp/f147-sNN && bun run lint > /tmp/f147-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f147-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f147-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f147-sNN/int.log 2>&1 && echo PROOF_OK`

## User checkpoints and steps

None. No migration, no new env key, no `bun.lock` change. The log names of D7 reach the VPS with the next release; the runbook (`docs/known-alerts.md`) changes in the same stage.

## Review

Stage 03 `[risky]` (event dedup keys): Opus review before the land. Stage 04 (log names, runbook): Sonnet review. Stages 01 and 02 land on the proof.

## Stages

| # | Stage | Needs | Mark |
| --- | --- | --- | --- |
| 01 | [Operator texts, kinds and events in core](stages/stage-01-core-texts.md) | nothing | |
| 02 | [One locale type and its lint rule](stages/stage-02-one-locale.md) | nothing; may run next to 01 | |
| 03 | [Event notices in the operator module](stages/stage-03-notices-move.md) | 01 | [risky] |
| 04 | [One delivery, one log vocabulary, test command](stages/stage-04-one-delivery.md) | 03 | |

## How to run (coordinator)

Move the ticket to `active/` and commit it. Spawn each stage whose Needs are met: board worker model, `--prepare 'bash scripts/limen-prepare.sh'`, text `Implement F147 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: § Proof of plan.md with NN.` Overlaps (advisory, merge master and re-prove): F143 stage 12 moves the operator block of `main.ts` into `start/operator.ts` (stages 03, 04); F129 converts CLIs (stage 04); F143 stage 01 and F150 change `eslint.config.js` (stage 02). Drop the job DB after each land.

## Planning progress

- Scouts: 3 (`scouts.md`).
- Files: `ticket.md`, `plan.md`, `questions.md`, `scouts.md`, stages 01–04 [written].
- Word counts (`wc -w`, before review): plan 1,294; stages 691 / 644 / 693 / 699.

## Cold review

Pending.

## Log

- 2026-11-20: plan written at base 22188c54.
