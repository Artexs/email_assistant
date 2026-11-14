# F099 stage 01 — Send-limit rule and config

Part of [`../plan.md`](../plan.md). Read its D1, D2, D3, D12, "Facts checked" (P2) and "Rules for every stage" first. Lane A, first stage. No migration, no DB.

Two steps. About 220 changed lines.

- [ ] **1.1 The pure rule `checkSendLimits` in core**
  - Goal: one pure function decides whether a send may start now, and if not, which limit holds it and until when.
  - Files:
    - add `packages/core/src/send-limits.ts`;
    - add `packages/core/src/send-limits.test.ts`;
    - change `packages/core/src/index.ts` (`export * from "./send-limits";`).
  - Interfaces:

    ```ts
    // packages/core/src/send-limits.ts — pure: no I/O, no Date.now()
    export const sendLimitKinds = ["mailbox_hour", "mailbox_day", "recipient_day"] as const;
    export type SendLimitKind = (typeof sendLimitKinds)[number];

    export interface SendLimits {
      mailboxHour: number; // sends per mailbox per rolling hour
      mailboxDay: number; // sends per mailbox per rolling 24 h
      recipientDay: number; // sends per mailbox and recipient address per rolling 24 h
    }
    export const DEFAULT_SEND_LIMITS: SendLimits = { mailboxHour: 20, mailboxDay: 100, recipientDay: 5 }; // PD-044
    export const SEND_LIMIT_WINDOW_MS: Record<SendLimitKind, number> = {
      mailbox_hour: 3_600_000,
      mailbox_day: 86_400_000,
      recipient_day: 86_400_000,
    };

    // A send that counts (plan.md D4): its start time and its recipients as stored in the payload.
    export interface RecentSend {
      startedAt: Date;
      to: readonly string[];
    }

    export type SendLimitResult = { kind: "ok" } | { kind: "held"; limit: SendLimitKind; until: Date };

    export function checkSendLimits(input: {
      now: Date;
      recent: readonly RecentSend[];
      to: readonly string[]; // the recipients of the send that wants to start
      limits: SendLimits;
    }): SendLimitResult;

    // "send_limit:<kind>" is the `actions.last_error` of a held send (plan.md D6, D11).
    export const SEND_LIMIT_ERROR_PREFIX = "send_limit:";
    export function sendLimitError(limit: SendLimitKind): string; // `send_limit:${limit}`
    export function sendLimitOfError(lastError: string | null): SendLimitKind | null; // null for any other text
    ```

  - Decisions: D2, D3, D12.
    - A send counts in a window when `startedAt > now − window` (strict). A send exactly one window old does not count.
    - For each window with `k ≥ cap` counted sends at ascending times `t[0..k−1]`: held until `t[k − cap] + window`.
    - `recipient_day`: for each distinct address of `input.to` (trimmed, lower-cased), count the recent sends whose `to` holds that address (trimmed, lower-cased); a recent send with an empty `to` counts only for the two mailbox windows.
    - Several holds: the latest `until` wins; equal `until`: the first of `mailbox_hour`, `mailbox_day`, `recipient_day`.
    - The function never returns `until <= now`.
  - Test (`send-limits.test.ts`; `NOW = 2026-11-20T10:00:00Z`; `limits = DEFAULT_SEND_LIMITS` unless a case says another; `r(offsetMs, to = ["x@x.test"])` builds a `RecentSend` at `NOW + offsetMs`; new send `to = ["n@x.test"]` unless a case says another):
    1. 19 sends at −59…−41 min → `ok`.
    2. 20 sends at −50, −49, …, −31 min → `held`, `mailbox_hour`, until `2026-11-20T10:10:00.000Z`.
    3. One send at exactly −60 min plus 19 sends at −50…−32 min → `ok`.
    4. 100 sends at −23 h + i × 13 min (i = 0…99) → `held`, `mailbox_day`, until `2026-11-20T11:00:00.000Z`.
    5. 5 sends to `a@x.test` at −10, −8, −6, −4, −2 h; new send to `[" A@X.test "]` → `held`, `recipient_day`, until `2026-11-21T00:00:00.000Z`.
    6. The 5 sends of case 5; new send to `["b@x.test"]` → `ok`.
    7. The 5 sends of case 5 plus the 20 sends of case 2; new send to `["a@x.test"]` → `held`, `recipient_day`, until `2026-11-21T00:00:00.000Z` (the later until wins).
    8. `limits = { ...DEFAULT_SEND_LIMITS, mailboxHour: 1 }`, one send at −59 min → `held`, `mailbox_hour`, until `2026-11-20T10:01:00.000Z`.
    9. 5 sends to `b@x.test` at −10, −8, −6, −4, −2 h; new send to `["a@x.test", "b@x.test"]` → `held`, `recipient_day`.
    10. The 20 sends of case 2 with `to: []` → `held`, `mailbox_hour` (an empty `to` still counts for the mailbox).
    11. The 20 sends of case 2 with `now = 2026-11-20T10:10:00Z` → `ok`.
    12. `recent: []`, `to: []` → `ok`.
    13. Two holds at once: `limits = { mailboxHour: 1, mailboxDay: 1, recipientDay: 5 }`, one send at −30 min → hour until `10:30`, day until `2026-11-21T09:30:00.000Z` → `held`, `mailbox_day` (the later until wins). Equal until: `limits = { mailboxHour: 20, mailboxDay: 1, recipientDay: 1 }`, one send at −30 min to `n@x.test`, new send to `["n@x.test"]` → `held`, `mailbox_day` until `2026-11-21T09:30:00.000Z` (`mailbox_day` comes before `recipient_day`).
    14. A send in the future (`r(+5 min)`) counts: `limits.mailboxHour = 1` → `held` until `2026-11-20T11:05:00.000Z`.
    15. `sendLimitError("mailbox_day")` is `"send_limit:mailbox_day"`; `sendLimitOfError` gives the kind back for each of the three, and `null` for `null`, `"send_limit"`, `"send_limit:other"`, `"smtp_421"`.
  - Check: `bun test packages/core/src/send-limits.test.ts`; `bun run typecheck`.
  - Done when: tests 1–15 pass; the file has no import from outside `packages/core`.
  - Out of scope: any DB read, any call site.

- [ ] **1.2 The three env keys**
  - Goal: the server reads the limits from env with the PD-044 defaults and stops on a bad value.
  - Files:
    - change `apps/server/src/platform/config.ts` (three keys, `sendLimits(config)`);
    - change `apps/server/src/platform/config.test.ts`;
    - change `.env.example` (after the `SEND_TEST_ADDRESSES` lines).
  - Interfaces:

    ```ts
    // platform/config.ts, in the schema next to SEND_SCOPE (shape of AUTH_SMTP_PORT: an empty string is the default)
    SEND_LIMIT_MAILBOX_HOUR: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(10_000).default(20)),
    SEND_LIMIT_MAILBOX_DAY: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(10_000).default(100)),
    SEND_LIMIT_RECIPIENT_DAY: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(10_000).default(5)),

    /** The send limits (PD-044). */
    export function sendLimits(config: Config): SendLimits;
    ```

    `.env.example` lines (exact):

    ```
    # Send limits per mailbox (PD-044): a send over a limit waits until the oldest send leaves the rolling window.
    SEND_LIMIT_MAILBOX_HOUR=20
    SEND_LIMIT_MAILBOX_DAY=100
    # Sends from one mailbox to one address per rolling 24 h.
    SEND_LIMIT_RECIPIENT_DAY=5
    ```

  - Decisions: D1 (no flag), D2.
  - Test (`config.test.ts`, a new `describe("send limits")`, with the file's `fullEnv` and `configError` helpers):
    16. No key set → `sendLimits(loadConfig(fullEnv))` equals `{ mailboxHour: 20, mailboxDay: 100, recipientDay: 5 }`.
    17. `"3"`, `"40"`, `"2"` → `{ 3, 40, 2 }`; an empty string for each → the defaults.
    18. Each of `"0"`, `"-1"`, `"1.5"`, `"abc"`, `"10001"` for each key → `configError(…).keys` contains that key.
  - Check: `bun test apps/server/src/platform/config.test.ts`; `bun run typecheck`.
  - Done when: tests 16–18 pass; `.env.example` lists the three keys.
  - Out of scope: the committer wiring (stage 04), the start log line (stage 04).

## Done when

- Steps 1.1 and 1.2 are done and committed by explicit paths.
- The Proof command of `plan.md` for stage 01 (`/tmp/f099-s01`) prints `PROOF_OK`.
