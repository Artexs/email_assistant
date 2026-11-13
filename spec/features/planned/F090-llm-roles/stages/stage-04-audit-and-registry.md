# F090 stage 04 — Role in every `llm.call` row; the prompt registry

Part of [`../plan.md`](../plan.md). **[risky]**: the daily cap counts these rows, and the classifier's prompt wiring moves to the registry. Review job before the land.

After this stage every `llm.call` row carries `role` and `prompt_version` through one writer (`recordLlmCall`), a count per role exists for a later cap share, and the classifier takes its role, version and builders from the prompt registry. The prompt text does not change.

## Step 1 — `recordLlmCall` and the count per role in `audit`

**Goal.** One function writes every `llm.call` row with the same data shape (D20); `countLlmCallsSince` counts per role when asked (D4, D21).

**Files.** `apps/server/src/modules/audit/repo.ts`, `apps/server/src/modules/audit/index.ts`, `apps/server/test/integration/rules-audit-repo.test.ts`.

**Interfaces.**

```ts
import type { LlmRole } from "@ea/core";

/** One LLM call attempt. Ids, codes and numbers only: never the prompt or the answer. */
export interface LlmCallRecord {
  emailId?: string;
  mailboxId: string;
  role: LlmRole;
  promptVersion: string;
  model: string;
  /** `ok` or the LLM error code. */
  outcome: string;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  at: Date;
}

// Every LLM call writes one `llm.call` row here: the daily cap and the cost per role read these rows.
export async function recordLlmCall(db: DbOrTrx, ctx: TenantContext, call: LlmCallRecord): Promise<void> {
  await recordAudit(db, ctx, {
    emailId: call.emailId,
    actor: "system",
    event: auditEvents.llmCall,
    reasonCode: call.outcome,
    data: {
      mailbox_id: call.mailboxId,
      role: call.role,
      model: call.model,
      prompt_version: call.promptVersion,
      tokens_in: call.tokensIn,
      tokens_out: call.tokensOut,
      latency_ms: call.latencyMs,
    },
    at: call.at,
  });
}
```

`countLlmCallsSince(db, ctx, mailboxId, since, opts: { role?: LlmRole } = {})`: without `role` the query is today's query (the triage cap). With `role: "classifier"` add `where (data->>'role' = 'classifier' or data->>'role' is null)`, because every row before this ticket is a classifier call. With another role add `where data->>'role' = <role>`. Use Kysely's `eb.or([...])` with `sql<string>\`data->>'role'\``. Keep the comment above the function and add one line: `// With a role: rows of that role; rows without a role count as classifier rows (written before roles existed).`

Export `recordLlmCall` and `type LlmCallRecord` from `audit/index.ts`.

**Decisions.** D4, D20, D21.

**Test** (`rules-audit-repo.test.ts`, new cases in the describe of the existing `countLlmCallsSince` case; one org from `createTwoTenants`, `since = 2026-11-04T08:00:00Z`, `inside = 2026-11-04T09:00:00Z`):

1. `recordLlmCall(trx, a.ctx, { emailId: undefined, mailboxId: a.mailboxId, role: "judge", promptVersion: "judge-v1", model: "m-j", outcome: "http_429", tokensIn: null, tokensOut: null, latencyMs: 12, at: inside })` writes one `audit_log` row with `event = "llm.call"`, `reason_code = "http_429"`, `actor = "system"`, `created_at = inside` and `data` equal to `{ mailbox_id: a.mailboxId, role: "judge", model: "m-j", prompt_version: "judge-v1", tokens_in: null, tokens_out: null, latency_ms: 12 }`.
2. Rows of mailbox A inside the window: one with `role: "classifier"` (by `recordLlmCall`), one old-shape row with no `role` key (by `recordAudit` with `llmCallData(a.mailboxId)`, the helper the file already has), one `judge`, one `drafter`. Then: no role → 4; `classifier` → 2; `judge` → 1; `drafter` → 1; `escalation` → 0. One `judge` row of another org and one before `since` do not count.

**Check.** `bun test apps/server/test/integration/rules-audit-repo.test.ts`

**Done when.** Both cases and the existing count case pass.

**Out of scope.** The cap share rule (E6a). Any change of the triage cap (it keeps the total count).

## Step 2 — Triage writes its rows through `recordLlmCall`

**Goal.** The triage success row and error row carry `role` (D4, D20).

**Files.** `apps/server/src/modules/triage/service.ts`, `apps/server/test/integration/triage-service.test.ts`.

**Interfaces.** Replace the two `recordAudit(… event: auditEvents.llmCall …)` calls (lines 500–513 and 522–535 today) with `recordLlmCall`:

- error path: `{ emailId: email.id, mailboxId: mailbox.id, role: "classifier", promptVersion: prompts.classifier.version, model: deps.llm.modelOf("classifier"), outcome: llmErrorCode(error), tokensIn: null, tokensOut: null, latencyMs: Date.now() - start, at: deps.now() }`, still inside its own `try`/`catch` with the same warn line;
- success path: `{ emailId: email.id, mailboxId: mailbox.id, role: usage.role, promptVersion: usage.promptVersion, model: usage.model, outcome: "ok", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs: usage.latencyMs, at: deps.now() }`.

`role: "classifier"` in the error path is a literal of a registered role (the step 3 test allows it). `prompts` comes from step 3; build step 3 first if you prefer, or use `PROMPT_VERSION` here and switch in step 3.

**Decisions.** D17 (the one intended assertion change), D20.

**Test** (`triage-service.test.ts`):

1. "an info mail is triaged with one ok llm.call row": the expected `data` (`toEqual`, line 331) gains `role: "classifier"`. Nothing else in the case changes.
2. "a 429 …" (the soft-error case, line 422): the `toMatchObject` gains `role: "classifier", prompt_version: "classifier-v2"`.
3. "a safety block goes to unsure at once …": add `expect(calls[0]?.data).toMatchObject({ role: "classifier", prompt_version: "classifier-v2", model: "fake-model" })`.
4. The case "a failed llm.call audit write does not hide the LLM error from the rules" passes unchanged (its proxy intercepts `insertInto("audit_log")`, which `recordLlmCall` reaches through `recordAudit`).

**Check.** `bun test apps/server/test/integration/triage-service.test.ts apps/server/test/integration/triage-job.test.ts`

**Done when.** The four cases and the rest of both files pass.

**Out of scope.** The `email.triaged` row (it already holds `prompt_version` and `model`; no role needed there).

## Step 3 — The prompt registry

**Goal.** One record names the prompt of each role; the classifier takes role, version and builders from it; a test keeps the record, the files and the code in line (D5, D22).

**Files.** New `apps/server/src/modules/triage/prompts/index.ts` and `prompts/index.test.ts`; `triage/classifier.ts`, `triage/service.ts`, `triage/eval.ts`, `triage/index.ts`, `apps/server/src/scripts/eval.ts`; one new case in `triage/classifier.test.ts`. Do not edit `prompts/classifier-v1.ts` or `prompts/classifier-v2.ts`.

**Interfaces.** `prompts/index.ts` (probe: a wrong version such as `"judge-v1"` in the classifier entry is a type error):

```ts
import type { LlmRole, PromptVersion } from "@ea/core";

import * as classifierV2 from "./classifier-v2";

/** The prompt of one role in one version; the builders differ per role. */
export interface PromptEntry<R extends LlmRole> {
  role: R;
  /** Equals the file name `<role>-v<n>.ts` and the file's `PROMPT_VERSION`. */
  version: PromptVersion<R>;
  [builder: string]: unknown;
}

// The prompt each role uses now. A new version is a new file `<role>-v<n>.ts`, a new entry here and a passing eval
// (docs/code-patterns.md § Side effects).
export const prompts = {
  classifier: {
    role: "classifier",
    version: classifierV2.PROMPT_VERSION,
    buildSystem: classifierV2.buildSystemPrompt,
    buildUser: classifierV2.buildUserPrompt,
  },
} as const satisfies { [R in LlmRole]?: PromptEntry<R> };

// Roles with no prompt yet, and the epic that writes it.
export const rolesWithoutPrompt = {
  judge: "E2a",
  drafter: "E6a",
  extractor: "E5b",
  escalation: "E3b",
} as const satisfies { [R in LlmRole]?: string };
```

- `classifier.ts`: import `prompts` from `./prompts` (keep `type ClassifierDelegate` from `./prompts/classifier-v2`); the call becomes `llm.generate({ role: prompts.classifier.role, promptVersion: prompts.classifier.version, schema: …, system: prompts.classifier.buildSystem(input.allowed), prompt: prompts.classifier.buildUser(input.email, input.sender, input.delegates, nonce), model: input.model })`; the return value's `promptVersion: prompts.classifier.version`.
- `service.ts`: drop the `PROMPT_VERSION` import; the blocked path and the error row use `prompts.classifier.version`.
- `eval.ts`: `PROMPT_VERSION` → `prompts.classifier.version` (keep `EXCERPT_CHARS` and `ClassifierDelegate` from `./prompts/classifier-v2`).
- `triage/index.ts`: replace `export { PROMPT_VERSION } from "./prompts/classifier-v2";` with `export { prompts, rolesWithoutPrompt } from "./prompts";` and `export type { PromptEntry } from "./prompts";`.
- `scripts/eval.ts`: `PROMPT_VERSION` → `prompts.classifier.version`.

**Decisions.** D5, D14, D22.

**Test.**

`prompts/index.test.ts` (probe: 4 pass on today's tree):

1. Every role in `llmRoles` is in exactly one of `prompts` and `rolesWithoutPrompt` (`Object.hasOwn`); the assertion message names the role (`expect(\`${role}:${inPrompts !== without}\`).toBe(\`${role}:true\`)`).
2. For each `[key, entry]` of `prompts`: `entry.role as string` equals `key`; `entry.version` matches `^<key>-v\d+$`; `await import(join(import.meta.dir, \`${entry.version}.ts\`))` has `PROMPT_VERSION === entry.version`.
3. Every file in `prompts/` that matches `^([a-z]+)-v(\d+)\.ts$` (today `classifier-v1.ts`, `classifier-v2.ts`): its first group is a role (`isLlmRole`) and its `PROMPT_VERSION` equals the file name without `.ts`. At least one file matches.
4. Source scan of `apps/server/src/modules` (`join(import.meta.dir, "../..")`), every `.ts` file that does not end in `.test.ts` and is not under `prompts/`: no file matches `/promptVersion:\s*["'\`]/`; for each match of `/\brole:\s*"([a-z]+)"/g` whose group is an LLM role, that role is a key of `prompts`. The failure lists `<file>: <problem>` lines (`expect(problems).toEqual([])`). Mutation check: put `role: "judge"` into a comment line of `triage/service.ts`, see case 4 fail, revert, and check `git status --short` shows no change of that file.

`classifier.test.ts`, one new case (the existing cases stay unchanged): "the call names the classifier role and the registry version": with the file's `fakeLlm`, `run()` records `call.role === "classifier"` and `call.promptVersion === prompts.classifier.version`, and `result.promptVersion` equals `"classifier-v2"`. Add `role` and `promptVersion` to the `Recorded` type for this.

**Check.** `bun test apps/server/src/modules/triage && bun run typecheck`

**Done when.** The four registry cases and the new classifier case pass; `git diff -- apps/server/src/modules/triage/prompts/classifier-v1.ts apps/server/src/modules/triage/prompts/classifier-v2.ts` is empty.

**Out of scope.** Moving the registry to `platform/llm/prompts/` (only when a second module has prompts, D5). Any prompt text.

## Stage done when

- Steps 1–3 are done; only the files of this stage changed.
- The proof of `plan.md` passes: `mkdir -p /tmp/f090-s04 && bun run lint > /tmp/f090-s04/lint.log 2>&1 && bun run typecheck > /tmp/f090-s04/typecheck.log 2>&1 && bun run test:unit > /tmp/f090-s04/unit.log 2>&1 && bun run test:int > /tmp/f090-s04/int.log 2>&1 && echo PROOF_OK`
