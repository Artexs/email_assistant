# F097 stage 01 — Test mail by sender (F057)

Part of [`../plan.md`](../plan.md). Review job before the land (real labels: what counts as real mail).

After this stage, mail from a configured test sender (the AgentMail inbox) counts as test mail everywhere the code asks "real or test": the real-label readers (`eval --real`, `triage:label`, the auto gate, `/review` later) and the `synthetic` scopes of triage and actions. Old feedback on such mail leaves the real labels at once (D1, retroactive by design).

Source of the old idea: `spec/features/dropped/2026-11/F057-testmail-mail-kind/plan.md` (option (a)).

## Step 1 — Config key and the rule type

**Goal.** One config key names the test senders; one value type carries them (D1).

**Files.** `apps/server/src/platform/config.ts`, `apps/server/src/platform/config.test.ts`, `.env.example`, `apps/server/src/modules/mail/seed.ts` (or the file that holds `isSyntheticMessageId`), `apps/server/src/modules/mail/index.ts`, a unit test next to `seed.ts`.

**Interfaces.**

```ts
// mail module (next to isSyntheticMessageId)
/** Lower-case sender addresses whose mail is test mail (TEST_SENDER_ADDRESSES). */
export interface TestMailRule {
  senders: readonly string[];
}
export const NO_TEST_SENDERS: TestMailRule = { senders: [] };

// Test mail = a synthetic Message-ID, or a sender in the rule. Not a security boundary: a sender can forge both.
export function isTestMail(
  mail: { messageIdHeader: string | null; fromAddress: string | null },
  rule: TestMailRule
): boolean;

// platform/config.ts
TEST_SENDER_ADDRESSES: z.preprocess(emptyAsUndefined, z.string().optional()),
export function testMailRule(config: Config): TestMailRule; // parseAddressList(...) lower-cased, deduplicated
```

`platform` may not import `modules`: define `TestMailRule` as a structural type in config (`{ senders: string[] }`) or return `string[]` from `testSenderAddresses(config)` and build the rule in the composition roots. Pick the one the border lint accepts; say which in the final message.

`.env.example`, under `SEND_TEST_ADDRESSES`:

```
# Test mail senders (comma list). Mail from these addresses counts as test mail: it is never a real label and only
# the `synthetic` scopes act on it. Example: the AgentMail inbox of evals/testmail/personas.json. Empty = none.
TEST_SENDER_ADDRESSES=
```

`configSchema` refuses an entry that is not an address (the same check `SEND_TEST_ADDRESSES` uses at `config.ts:258`).

**Decisions.** D1.

**Test** (unit):

1. `isTestMail({ messageIdHeader: "<a@ea-seed.test>", fromAddress: "x@y.test" }, NO_TEST_SENDERS)` → `true`.
2. `isTestMail({ messageIdHeader: "<a@ses.amazonaws.com>", fromAddress: "EA-TestMail-75wd@AgentMail.to" }, { senders: ["ea-testmail-75wd@agentmail.to"] })` → `true` (case-insensitive).
3. `isTestMail({ messageIdHeader: null, fromAddress: null }, { senders: ["a@b.test"] })` → `false`.
4. `isTestMail({ messageIdHeader: "<a@x.test>", fromAddress: "boss@firma.test" }, { senders: ["a@b.test"] })` → `false`.
5. Config: `TEST_SENDER_ADDRESSES=" A@b.test, c@d.test ,"` → senders `["a@b.test", "c@d.test"]`; empty or missing → `[]`; `"not-an-address"` → config error naming `TEST_SENDER_ADDRESSES` (key name only).

**Check.** `bun test apps/server/src/platform/config.test.ts apps/server/src/modules/mail/`

**Done when.** Cases 1–5 pass.

**Out of scope.** Any other config key.

## Step 2 — `mailKindFilter` takes the rule; the real-label readers pass it

**Goal.** SQL "real" excludes test senders; SQL "synthetic" includes them (D1).

**Files.** `mailKindFilter` lives in `apps/server/src/modules/mail/repo.ts:34` today, or in `mail/repo/emails.ts` when F091 stage 02 has landed (`grep -rn "export function mailKindFilter" apps/server/src`). Callers (grep `mailKindFilter(` and `mail: MailKind` / `mail: "real"`): `mail/repo` (3), `actions/repo` (2), `triage/repo.ts` (`listUnlabeled`, `listLabeledResults`, the third at line ~384), `triage/feedback.ts` (`listForLabeling`), `triage/gate.ts`, `triage/eval-real.ts`, `scripts/eval.ts` (`runReal`), `scripts/triage-label.ts`, `scripts/triage-cost.ts`, `scripts/testmail-target.ts`, and the integration tests that call them.

**Interfaces.**

```ts
export function mailKindFilter(kind: MailKind, rule: TestMailRule): Expression<SqlBool>;
// synthetic: message_id_header ILIKE SYNTHETIC_MESSAGE_ID_LIKE OR lower(from_address) IN rule.senders
// real:      (message_id_header IS NULL OR message_id_header NOT ILIKE …) AND (from_address IS NULL OR lower(from_address) NOT IN rule.senders)
// With rule.senders empty, the SQL is today's SQL (no IN () clause: Postgres refuses an empty IN list).
```

The repo functions take the rule in their existing `opts` object: `opts: { mail: MailKind; testMail: TestMailRule }`. The composition roots and scripts build it from config (`testMailRule(config)` or equivalent). `triage/gate.ts` (`setCategoryAutoWithGate`) gets the rule from its caller (the web route deps or the CLI); follow the type errors.

**Decisions.** D1.

**Test** (integration, extend `apps/server/test/integration/` tests of `listLabeledResults` / `listUnlabeled`; one org from the existing helpers; three mails in one mailbox, each with a triage result and a feedback row: A real (`from = boss@firma.test`, Message-ID `<1@mail.firma.test>`), B AgentMail (`from = ea-testmail-75wd@agentmail.to`, Message-ID `<x@ses.test>`), C seeded (Message-ID `<c@ea-seed.test>`)):

1. Rule `{ senders: ["ea-testmail-75wd@agentmail.to"] }`, `mail: "real"` → only A.
2. Same rule, `mail: "synthetic"` → B and C.
3. Rule with no senders, `mail: "real"` → A and B (today's behaviour).
4. Sender stored as `EA-TestMail-75wd@AgentMail.to` → still treated as test mail (lower-case compare).
5. A mail with `from_address` NULL and a real Message-ID → real under any rule.

**Check.** `bun test apps/server/test/integration/<the files you changed>` (needs your job DB).

**Done when.** Cases 1–5 pass; every old test that called these functions passes with `NO_TEST_SENDERS`.

**Out of scope.** The `synthetic` marker in Telegram notices and the digest (`channels/notices/*.ts`, `reports/digest.ts` call `isSyntheticMessageId` for display only): they stay as they are. Name them in the final message as a follow-up idea.

## Step 3 — The scopes

**Goal.** `TRIAGE_LLM_SCOPE=synthetic` and `ACTIONS_SCOPE=synthetic` treat sender test mail as test mail (D1; the old F057 done-when).

**Files.** `apps/server/src/modules/actions/scope.ts`, `actions/repo.ts` (`MailboxClaimFilter`, `mailboxFilterExpr` and the expression at ~line 390), `apps/server/src/composition.ts` (`actionsScope`), `apps/server/src/main.ts`, the mail claim functions with `syntheticOnly` (`mail/repo` ~969, ~1078), the Undo path that calls `scopeAdmits`, their tests.

**Interfaces.**

```ts
export type ActionsScope = { kind: "off" } | { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };
export type MailboxClaimFilter = { kind: "none" } | { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };
export function scopeAdmits(
  filter: MailboxClaimFilter,
  mail: { messageIdHeader: string | null; fromAddress: string | null }
): boolean;
```

The mail claim functions take `syntheticOnly: false | { testMail: TestMailRule }` (or a `testMail` field next to `syntheticOnly: boolean`; pick one, keep it typed).

**Decisions.** D1.

**Test.**

1. Unit `scope.test.ts`: `scopeAdmits({ kind: "synthetic", testMail: { senders: ["t@a.test"] } }, { messageIdHeader: "<r@x.test>", fromAddress: "t@a.test" })` → `true`; with `fromAddress: "boss@firma.test"` → `false`; `{ kind: "all" }` → `true`; `{ kind: "none" }` → `false`.
2. Integration (the existing actions claim test file): with scope `synthetic` and the rule above, a planned `move` of a mail from `t@a.test` is claimed; one from `boss@firma.test` is not.

**Check.** `bun test apps/server/src/modules/actions/ apps/server/test/integration/<changed files>`

**Done when.** Both cases pass and the old scope tests pass.

**Out of scope.** `SEND_SCOPE` (it filters by recipient, not by mail kind).
