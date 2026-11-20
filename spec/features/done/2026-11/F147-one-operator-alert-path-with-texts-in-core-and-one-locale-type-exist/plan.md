# F147 plan — one operator alert path, texts in core, one locale type

> **Status 2026-11-20 — planned.** Plan base: 22188c54. No stage built.

## Input

Owner words (quality pass 2, `spec/quality/2026-11-20-pass-2.md` finding 8, fix): "Short step: replace the three locale unions by `UserLocale`. Ticket line: "One operator alert path: the five hourly operator notices become kinds of the `ops_alerts` mechanism, and the alert texts move to `packages/core/src/texts/operator.ts`"."

### Decisions taken

- **D1 One mechanism, two state stores** (default, owner to confirm; `questions.md` Q1). One kind list with a lifecycle per kind: `incident` (the five `slo_*` kinds: open, repeat, resolve; state in `ops_alerts`, host-wide) and `once` (the five event kinds: one text per key; state stays the audit row `operator.notice` in the organization of the event). Both lifecycles share the kind list, the texts, the delivery, the log lines and the test command. Reason: `ops_alerts` has no `org_id` and holds no ids by an owner rule exception (2026-11-15); event keys hold organization, mailbox and user ids, and the audit row already goes with the organization delete and sits in the export and erase maps. Rejected: event rows in `ops_alerts` (an `org_id` column, privacy-map entries, a key-copy migration).
- **D2 Texts in core, same words.** Every operator text lives in `packages/core/src/texts/operator.ts` (en, pl); the renderers in `packages/core/src/ops/alert-text.ts`. The moved tests keep their expected strings.
- **D3 Event facts and keys in core.** `OperatorEvent` (a union by kind) and `operatorEventKey(event)` live in core. The key is byte-identical to `HEAD`: a changed key sends every past notice again.
- **D4 Module.** The event notices move from `channels` to `operator` (`operator/notices.ts`); the layer order allows it. Callers get them as hooks from the composition roots, as now.
- **D5 Schedules stay.** `channels.operator` (hourly, minute 13) and `ops.slo` (every 5 min) keep names, times and order. Rejected: one job (changes timing and the pinned job list).
- **D6 One delivery.** `createOperatorDelivery` (stage 04) sends one text. No operator chat counts as delivered for both lifecycles (as at `HEAD`). A failed send returns false and writes no mark.
- **D7 One log vocabulary** (default; Q2). Every line has an explicit level; a lost alert stays an `error` line, because the release watch counts `level=error` lines (`deploy/README.md`).
  - `operator_alert_sent` info `{ kind, status }`: a text went out (new for events).
  - `operator_alert_unsent` warn `{ kind, status }`: no operator chat; counts as delivered (incidents: was info `slo_alert_sent`).
  - `operator_alert_send_failed` error `{ kind, status, telegram error fields }`: once per alert key per process (incidents: was warn, every tick).
  - `operator_alert_failed` error `{ kind, error fields }`: a state read or write threw (audit dedup row, `ops_alerts` row), or a hook could not build its event (an invalid date) (incidents: was warn `slo_check_failed`).
  - `operator_check_failed` error `{ kind?, error fields }`: a check or a detector part threw; `kind` is the kind it detects; the retry part has no kind, as at `HEAD` (incidents: was warn `slo_check_failed`).
  - `operator_alerts_on` info `{ kind: log | telegram }`: the start-up line (was `operator_notices_on`).
  - `status` of an event is always `open`. The names `operator_notice_*`, `operator_notices_*`, `slo_alert_*` and `slo_check_failed` go.
- **D8 Retry rules stay.** Incident: next tick. Event: the hourly run finds `trial_ending`, `auth_error_24h`, `send_limit` again and retries failed `llm_cap` and `send_limit` sends from memory; `auth_mail_failed` is not retried.
- **D9 Test command for all kinds** (default; Q3). `ops:alert-test --kind <any of 10>` or `--all` (incident kinds in `SLO_KINDS` order, then event kinds in `OPERATOR_EVENT_KINDS` order). An event test text is the line `TEST <kind>`, then the event text of a fixed sample event. It writes no audit row and no `ops_alerts` row.
- **D10 One locale type.** `UserLocale`, `userLocales` and `userLocaleSchema` (`packages/core/src/tenancy.ts`) are the language of every text the product shows: docs, web, operator texts, `OPERATOR_LOCALE`, the push payload `lang`. The language of a mail, a draft or a sim slot (it may hold `other` or `de`) is another concept and keeps its types. Rejected: one type for both (a new interface language would then claim draft support). A third interface language is one edit for the type; the legal pages still need their own documents and a new version digest.
- **D11 Ordered lists.** A list that equals `userLocales` in order becomes `userLocales`. A list in another order (for example the screenshot order) stays, typed `readonly UserLocale[]`.
- **D12 Guard.** A local lint rule `ea/no-locale-union` fails on a union of exactly the literal types `"en"` and `"pl"`, on an `as const` array of exactly those two strings, and on `z.enum` of exactly those two (also `as const`). It covers non-test code of `apps/docs/src`, `apps/web/src`, `apps/server/src` and `packages/core/src`, except `tenancy.ts` and the mail-language folders that stage 02 lists. A mail-language site outside those folders uses a named mail-language type, or `// eslint-disable-next-line ea/no-locale-union -- mail language`.
- **D13 Locale is required.** `createOperatorNotices`, `runSloTick` and `sendTestAlerts` take `locale: UserLocale` with no default; `OPERATOR_LOCALE` (default `en`) is the one default.

Edge cases: a crash between send and mark repeats one text (D6, D8); a restart loses only the in-memory retries (as at `HEAD`); suspended organizations and a second server process behave as at `HEAD`. A log line never holds the text, the chat id or the Telegram description.

## Facts checked

All read 2026-11-20 and confirmed by review 1:
- Layers: `channels` is layer 4, `operator` layer 5; `operator` already imports `channels`.
- `ops_alerts`: SQL CHECK of the five `slo_*` kinds, no `org_id`, no retention.
- Event keys and texts: `channels/operator.ts`, `texts/operator.test.ts`; key values computed with `bun -e`.
- `apps/docs` depends on `@ea/core`; `bun run typecheck` runs `astro check`; `eslint .` lints `.astro`.
- `telegramErrorFields` is not in the `channels` index (stage 03 exports it).

- A local rule sees a `"en" | "pl"` union in `.astro` frontmatter; an `.astro` config block needs its own `plugins: { ea }` (review 1, note 11, ESLint probe).

## Not verified

- None.

## Done when

`ticket.md` § Acceptance (5 items).

## Rules for every stage

- Words, keys, schedules and thresholds do not change. A test whose expected string or key must change is a stop: report it. Allowed test edits: import paths, renamed types, `locale: "en"` where D13 makes it required, and the log names and levels of D7 (stage 04).
- A gap in a decision, or a deviation, is a question in the final message.
- Format only the files of the stage. Probes go to `/tmp/f147-sNN/`.
- A stage that adds or removes an import between modules runs `bun run graph:modules` and commits its output.
- Update the capability page of the behaviour in the same stage (PD-009).

## Proof

`mkdir -p /tmp/f147-sNN && bun run lint > /tmp/f147-sNN/lint.log 2>&1 && bun run typecheck > /tmp/f147-sNN/typecheck.log 2>&1 && bun run test:unit:ci > /tmp/f147-sNN/unit.log 2>&1 && bun run test:int:ci > /tmp/f147-sNN/int.log 2>&1 && echo PROOF_OK`

## User checkpoints and steps

None (no migration, env key or `bun.lock` change). The D7 names reach the VPS with the next release; the runbook changes in stage 04.

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

Move the ticket to `active/` and commit it. Spawn each stage whose Needs are met: board worker model, `--prepare 'bash scripts/limen-prepare.sh'`, text `Implement F147 stage NN. Read ticket.md, plan.md and stages/stage-NN-<slug>.md. Final proof: plan.md § Proof.` Advisory overlaps: F143 stage 12 moves the operator block of `main.ts` to `start/operator.ts` (stages 03, 04); F129 converts CLIs (04); F143 stage 01 and F150 edit `eslint.config.js` (02). Drop the job DB after each land.

## Planning progress

- Scouts: 3 (`scouts.md`).
- Files: `ticket.md`, `plan.md`, `questions.md`, `scouts.md`, stages 01–04 [written].
- Word counts (`wc -w`): see § Log.

## Cold review

Opus 5.5, thinking high (stage 03 is `[risky]`: dedup keys). Verdict FAIL: 1 blocking, 11 notes (`plan-review-1.md`). All fixed, none rejected: B1 levels in D7 and Q2, test 2 of stage 04; N1 hook input and retry part in D7; N2 allowed test edits (Rules); N3 event status; N4 key and text built in the hook (stage 03); N5 `as const` lists in D12; N6 escape in D12; N7 CLI case (stage 04); N8 numbering; N9 legal note in D10; N10 `operator_alerts_on`; N11 fact moved to Facts checked.

## Log

- 2026-11-20: plan written at base 22188c54; review 1 fixed. Words after the fixes: plan 1,492; stages 691 / 681 / 687 / 697.
