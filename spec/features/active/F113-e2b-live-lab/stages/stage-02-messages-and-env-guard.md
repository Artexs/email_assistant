# F113 stage 02 — lab messages and env guard

Part of [`../plan.md`](../plan.md). Decisions D3, D4, D7.

## Step 1 — lab messages

**Goal.** A pure mapping from a week slot plus its text to one message, and the Message-ID scheme that lets every later part find the slot again.

**Files.** `packages/core/src/sim/live/message.ts`; server adapter in the new module `apps/server/src/modules/lab/` (later stages add the rest; create its `index.ts` here if it does not exist, and register the module as the module-border rules of `docs/code-patterns.md` require).

**Interfaces.**

```ts
labMessageId(slotId: string, runId: string, domain: string): string;   // "<w-1-001.week-20261123-a1b2@kordelan.test>"
parseLabMessageId(raw: string): { slotId: string; runId: string } | null;
type LabMessage = {
  kind: "smtp" | "append_sent"; messageId: string;
  from: { name: string; address: string }; to: string[]; cc: string[];
  subject: string; date: string; text?: string; html?: string;
  inReplyTo?: string; references: string[]; headers: Record<string, string>;
};
toLabMessage(input: { slot: Slot; text: SimText; scenario: Scenario; plan: LiveRunPlan; mailbox: string; parents: Slot[] }): LabMessage;
// server, modules/lab:
renderLabMessage(m: LabMessage): string;   // through renderSeedMessage
```

**Decisions.**
- Domain of the Message-ID = the domain of the sender's address. `parseLabMessageId` takes the id with or without angle brackets. It returns null unless the run part matches `^(day|week)-\d{8}-[0-9a-f]{4}$` and the slot part matches `^w-\d-\d{3}$` (review N12: a bot reply id `<r.<hex>@…>` never parses).
- Persona keys become addresses (`fromOverride` wins for the sender). The executive key becomes `mailbox`, the address of the run's mailbox.
- `direction: "sent"` → `kind: "append_sent"`, `from` = the executive at `mailbox`. Else `kind: "smtp"`.
- `parents` is the chain from the thread root to the direct parent. `inReplyTo` = the parent's id in this run; `references` = the chain's ids in order.
- `date` = the plan item's `at`. Subject, text and HTML pass through `shiftDatesInText` (stage 01) with `plan.offsetDays`.
- `html_only` slots carry `html` only. `headers` come from the slot unchanged.
- `renderLabMessage` maps `LabMessage` onto `SeedMessage`. It never uses the synthetic Message-ID domain: inside the sim stack, lab mail is real mail.

**Test.**
1. `labMessageId("w-1-001", "week-20261123-a1b2", "kordelan.test")` = `<w-1-001.week-20261123-a1b2@kordelan.test>`; parse gives the two parts back; `<abc@x.test>` and `<r.0123456789ab.done@kordelan.test>` parse to null.
2. A reply slot with a 2-deep chain → `inReplyTo` = the parent id, `references` has 2 ids, root first.
3. A `sent` slot → `append_sent`, `from.address` = `mailbox`.
4. A bounce slot with `fromOverride` `mailer-daemon@kordelan.test` → that `from`.
5. Corpus test (server): all 855 week slots map and render with no throw, with plan `week-20261123-a1b2`; each rendered id parses back to its slot.

## Step 2 — env guard

**Goal.** One check that keeps the lab off any stack that is not the sim stack.

**Interfaces.**

```ts
type SimEnvIssue =
  | "not_sim_stack" | "local_hosts_off" | "telegram_root_not_loopback" | "telegram_token_not_fake"
  | "send_scope_not_self" | "send_address_not_scenario" | "triage_scope_not_all" | "actions_scope_not_all"
  | "heartbeat_set" | "operator_chat_set" | "operator_users_set" | "auth_mail_set";
checkSimEnv(env: Record<string, string | undefined>, allowedAddresses: string[]): SimEnvIssue[];
LAB_FAKE_TELEGRAM_TOKEN: string;   // equals the fake's default token
isLoopbackApiRoot(value: string): boolean;   // moved to core; platform/config.ts imports it (one rule)
```

**Decisions.**
- Required: `LAB_STACK=ea-sim`; `MAIL_ALLOW_LOCAL_HOSTS=true`; `TELEGRAM_API_ROOT` set and loopback (unset means the real Telegram → `telegram_root_not_loopback`; review T11); `TELEGRAM_BOT_TOKEN` = `LAB_FAKE_TELEGRAM_TOKEN`; `SEND_SCOPE=self`; every `SEND_TEST_ADDRESSES` entry is in `allowedAddresses` and ends in `.test`; `TRIAGE_LLM_SCOPE=all`; `ACTIONS_SCOPE=all`; `HEARTBEAT_URL`, `OPERATOR_TELEGRAM_CHAT_ID`, `OPERATOR_USER_IDS` and every `AUTH_SMTP_*` key unset or empty (auth mail is a third outbound path; sign-in links come from `web:invite --print`; review T11, N3).
- `isLoopbackApiRoot` moves from `platform/config.ts` to core unchanged; the config imports it (core may not import apps; review N2).
- `allowedAddresses` = `labAddresses(corpus)` (stage 04).
- Issues are codes in a fixed order. No value of a key goes into an issue, a log line or an error.

**Test.**
6. A valid env → `[]`.
7. Each single wrong key gives exactly its one code (12 cases, one per code); `TELEGRAM_API_ROOT` unset → `telegram_root_not_loopback`; `AUTH_SMTP_HOST=greenmail` → `auth_mail_set`.
8. A test in the server asserts `LAB_FAKE_TELEGRAM_TOKEN` equals the fake's default token.
9. `SEND_TEST_ADDRESSES=a@kordelan.test,b@gmail.com` → `send_address_not_scenario`.
10. The server config tests for the Telegram root still pass with the moved function.

## Done when

Tests 1–10 pass; the Proof prints `PROOF_OK`.

## Out of scope

SMTP and IMAP calls (stage 07). The CLI (stage 05).
