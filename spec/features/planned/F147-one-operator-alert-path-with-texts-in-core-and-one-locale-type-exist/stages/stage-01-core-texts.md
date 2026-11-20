# F147 stage 01 — operator texts, kinds and events in core

Needs: nothing. May run next to 02 (02 may change the `AlertLocale` line of `slo-texts.ts`; this stage deletes the file: on a conflict keep the delete).
Part of [`../plan.md`](../plan.md).

## Goal

All operator words and both renderers live in `@ea/core`. The service-level alert path calls the core renderer; `apps/server/src/modules/operator/slo-texts.ts` is gone. The event notices (`channels/operator.ts`) are not touched here (stage 03). No text changes (D2).

## Step 1 — kinds and events (D1, D3)

- **File** `packages/core/src/ops/kinds.ts` (extend):
  - `OPERATOR_EVENT_KINDS = ["trial_ending", "llm_cap", "auth_error_24h", "auth_mail_failed", "send_limit"] as const` (the `HEAD` order of `OperatorNoticeKind`), `type OperatorEventKind`.
  - `OPERATOR_ALERT_KINDS = [...SLO_KINDS, ...OPERATOR_EVENT_KINDS] as const`, `type OperatorAlertKind`.
  - `ALERT_LIFECYCLE: Record<OperatorAlertKind, "incident" | "once">` (registry; every `slo_*` is `incident`, every event kind `once`).
- **File** `packages/core/src/ops/events.ts` (new):
  ```ts
  export type OperatorEvent =
    | { kind: "trial_ending"; orgId: string; endsAt: Date; ended: boolean }
    | { kind: "auth_error_24h"; orgId: string; mailboxId: string; since: Date }
    | { kind: "llm_cap"; orgId: string; mailboxId: string; cap: number; dayStart: Date }
    | { kind: "auth_mail_failed"; orgId: string; userId: string; mail: "invite" | "reset" | "lockout"; code: string; at: Date }
    | { kind: "send_limit"; orgId: string; mailboxId: string; limit: SendLimitKind; at: Date; until: Date };
  export function operatorEventKey(event: OperatorEvent): string;
  ```
  The key formats are the `HEAD` formats of `channels/operator.ts`, byte for byte. Stage 03 builds on these names.

## Step 2 — texts and renderers (D2)

- **File** `packages/core/src/texts/operator.ts`: `OperatorTexts` gains `slo` with the `HEAD` `Words` of `slo-texts.ts` (state line, `more`, `runbook`, id labels, facts per `SloKind`), en and pl. Event texts stay as they are.
- **File** `packages/core/src/ops/alert-text.ts` (new):
  - `export type AlertTextPhase = "open" | "repeat" | "resolved" | "test"`.
  - `export interface SloTextInput` = the `HEAD` input without `locale`.
  - `export function renderSloAlert(input: SloTextInput, locale: UserLocale): string` — the `HEAD` `sloAlertText` logic (fact reader with the Polish decimal comma, at most five ids, `+N more`, no ids for `resolved`, the runbook line).
  - `export function renderOperatorEvent(event: OperatorEvent, locale: UserLocale): string` — picks the event text of `textsFor(locale).operator` (`trial_ending` with `ended` true gives `trialEnded`). Dates go in as ISO strings, as the `HEAD` callers pass them.
  - `SLO_TEST_FACTS` and `SLO_TEST_IDS` (the `HEAD` `TEST_FACTS`, `TEST_IDS`).
- Export the new names from the core index (not from `@ea/core/web`).

## Step 3 — server switch

- `operator/slo-job.ts`, `operator/alerts-service.ts`, `scripts/ops-alert-test.ts` call `renderSloAlert`. `SloTickDeps.locale` and the `sendTestAlerts` input `locale` become `UserLocale`, required (D13); `main.ts` and the CLI pass `config.OPERATOR_LOCALE`.
- Delete `slo-texts.ts`; the operator index stops exporting its names. Move `slo-texts.test.ts` to `packages/core/src/ops/alert-text.test.ts`; keep every expected string.

## Test

Fixed values: `ORG` `11111111-1111-4111-8111-111111111111`, `BOX` `22222222-2222-4222-8222-222222222222`, `USER` `33333333-3333-4333-8333-333333333333`, `AT` `2026-11-18T10:00:00.000Z`, `UNTIL` `2026-11-18T10:10:00.000Z`.

1. The moved alert-text tests pass with no expected string changed (en and pl, all phases, `+N more`, decimal comma).
2. `operatorEventKey`, a `test.each` table:
   - trial_ending (ORG, endsAt AT, ended false) → `trial_ending:11111111-1111-4111-8111-111111111111:1794996000000`; the same with ended true → the same key.
   - auth_error_24h (BOX, since AT) → `auth_error_24h:22222222-2222-4222-8222-222222222222:1794996000000`.
   - llm_cap (BOX, dayStart AT) → `llm_cap:22222222-2222-4222-8222-222222222222:2026-11-18T10:00:00.000Z`.
   - auth_mail_failed (USER, code `EAUTH`, at `2026-11-18T23:59:59.000Z`) → `auth_mail_failed:33333333-3333-4333-8333-333333333333:EAUTH:2026-11-18`.
   - send_limit (BOX, at AT) → `send_limit:22222222-2222-4222-8222-222222222222:2026-11-18`.
3. `renderOperatorEvent`, a `test.each` table, en: each case gives the string of `texts/operator.test.ts` for the same values (trial ends, trial ended, auth error, llm cap 300, auth mail `reset` `EAUTH`, send limit `mailbox_hour` AT UNTIL). pl: trial ended and llm cap 3 (`(3 wywołania)`).
4. Registry: `ALERT_LIFECYCLE` has exactly the keys of `OPERATOR_ALERT_KINDS`; each `SLO_KINDS` value maps to `incident`, each `OPERATOR_EVENT_KINDS` value to `once`; the two lists share no value.
5. Existing guards pass with no assert change: `texts/operator.test.ts`, `texts/index.test.ts` (same keys in both locales), `ops/alert-step.test.ts`, `ops-slo-job.test.ts` (it adds `locale: "en"` where D13 requires it).
6. Mutation: change one Polish word in `slo` of `texts/operator.ts`; case 1 fails. Change the `llm_cap` key separator; case 2 fails. Revert both; write them in the final message.

## Docs

`docs/capabilities/operations.md` § Alerts: the texts and the renderer live in core (`texts/operator.ts`, `ops/alert-text.ts`).

## Done when

- `slo-texts.ts` and `AlertLocale` do not exist; cases 1–6 hold.
- Proof: `plan.md` § Proof with `NN=01`.

## Out of scope

The event notices (stage 03), log names (04), other locale copies (02).
