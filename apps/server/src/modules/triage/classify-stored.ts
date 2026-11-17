// The history check's classifier (F110 stage 07, interfaces `classifyStored`): one stored mail through the same steps as triage, without any
// write. No `triage_results` row, no action, no status change. The caller owns the `llm.call` row (through `onCall`), the cost and the item.
import {
  applyHardRules,
  ASSIST_DEFAULT_SWITCHES,
  decideCategory,
  decidePolicy,
  planActions,
  type Category,
  type ToolSwitches,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { llmErrorCode, type LlmClient, type LlmUsage } from "../../platform/llm";
import type { LlmCallRecord } from "../audit";
import { getStoredEmail, type TestMailRule } from "../mail";

import { classifyEmail } from "./classifier";
import { buildClassifierInput } from "./classify-input";
import type { ClassifierPromptChoice } from "./prompts";
import type { TriageMailbox } from "./service";
import { assessEmail } from "./suspicious-context";

/** What `classifyStored` tells the caller about one model call: the caller writes the `llm.call` row from it. */
export type StoredCall = Pick<
  LlmCallRecord,
  "role" | "promptVersion" | "model" | "endpoint" | "outcome" | "tokensIn" | "tokensOut" | "latencyMs" | "at"
>;

export interface ClassifyStoredDeps {
  db: Db | Transaction<DB>;
  llm: LlmClient;
  testMail: TestMailRule;
  /** Absent: the production prompt. */
  prompt?: ClassifierPromptChoice;
  /** The settings snapshot of the mailbox: the thresholds, the sender rules, the delegates, the urgency profile. */
  mailbox: TriageMailbox;
  now(): Date;
  /** Called after each model call, also after a failed one (usage `null`). A failure in it does not hide the call's own error. */
  onCall?(call: StoredCall): Promise<void>;
}

export interface StoredClassification {
  category: Category;
  confidence: number;
  reasonCode: string;
  wouldMove: boolean;
  /** `null` for a hard-rule result: no call was made. */
  usage: LlmUsage | null;
  source: "rule" | "classified";
}

// The plan in `assist` mode with the default switches of the mode change and `auto` on for the category (the question of the history
// check: would this category have moved the mail?). A VIP mail is never moved; the mailbox's move support does not count.
const WOULD_DO_SWITCHES: ToolSwitches = {
  move: false,
  mark_read: false,
  flag: false,
  create_draft: false,
  move_unsure: false,
  ...ASSIST_DEFAULT_SWITCHES,
};

/** True when `assist` mode with `auto` on for `category` would move a mail of this sender kind out of the INBOX. */
export function wouldMoveOf(category: Category, opts: { vip: boolean; fromJunk?: boolean }): boolean {
  return planActions(category, null, undefined, { fromJunk: opts.fromJunk === true }).some(
    (action) =>
      action.type === "move" &&
      decidePolicy(action, {
        mode: "assist",
        toolSwitches: WOULD_DO_SWITCHES,
        category,
        categoryAuto: true,
        vip: opts.vip,
        movesSupported: true,
      }) === "apply"
  );
}

/**
 * The hard rules, then the model call, then `decideCategory` with the mailbox thresholds, then the would-do plan. A blocklisted
 * sender is `spam` with no call. A model error goes to the caller unchanged (after `onCall`).
 */
export async function classifyStored(
  deps: ClassifyStoredDeps,
  ctx: TenantContext,
  emailId: string
): Promise<StoredClassification> {
  const { mailbox } = deps;
  const email = await getStoredEmail(deps.db, ctx, emailId);
  if (email === undefined || email.mailbox_id !== mailbox.id) throw new HardError("history mail not found");
  const rules = applyHardRules(email.from_address, mailbox.rules, { delegation: mailbox.delegates.length > 0 });
  if (rules.kind === "spam") {
    return {
      category: "spam",
      confidence: 1,
      reasonCode: "blocklist",
      wouldMove: wouldMoveOf("spam", { vip: false }),
      usage: null,
      source: "rule",
    };
  }
  const suspiciousReasons = await assessEmail(deps.db, ctx, mailbox.suspicious, email);
  const { choice, classifierEmail, extras } = await buildClassifierInput(deps, ctx, mailbox, email, suspiciousReasons);
  const start = Date.now();
  // A call that answered but whose answer `classifyEmail` refused (the answer names a category that the sender rules forbid) has real
  // usage that the error does not carry. The wrapper keeps it, so the failed call is recorded and counted at its tokens.
  const answered: { usage: LlmUsage | null } = { usage: null };
  const llm: LlmClient = {
    modelOf: (role) => deps.llm.modelOf(role),
    endpointOf: (role) => deps.llm.endpointOf(role),
    async generate(call) {
      const reply = await deps.llm.generate(call);
      answered.usage = reply.usage;
      return reply;
    },
  };
  let result: Awaited<ReturnType<typeof classifyEmail>>;
  try {
    result = await classifyEmail(llm, {
      email: classifierEmail,
      sender: { whitelisted: rules.whitelisted, vip: rules.vip, noreply: rules.noreply },
      allowed: rules.allowed,
      delegates: mailbox.delegates.map(({ id, name, tags }) => ({ id, name, tags })),
      extras,
      prompt: choice,
    });
  } catch (error) {
    try {
      await deps.onCall?.({
        role: "classifier",
        promptVersion: choice.version,
        model: answered.usage?.model ?? deps.llm.modelOf("classifier"),
        endpoint: answered.usage?.endpoint ?? deps.llm.endpointOf("classifier"),
        outcome: llmErrorCode(error),
        tokensIn: answered.usage?.tokensIn ?? null,
        tokensOut: answered.usage?.tokensOut ?? null,
        latencyMs: Date.now() - start,
        at: deps.now(),
      });
    } catch {
      // The call row is a record: its failure must not hide the error of the call.
    }
    throw error;
  }
  const { analysis, usage } = result;
  await deps.onCall?.({
    role: usage.role,
    promptVersion: usage.promptVersion,
    model: usage.model,
    endpoint: usage.endpoint,
    outcome: "ok",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    latencyMs: usage.latencyMs,
    at: deps.now(),
  });
  const { category } = decideCategory(analysis, mailbox.policy);
  return {
    category,
    confidence: analysis.confidence,
    reasonCode: analysis.reason_code,
    wouldMove: wouldMoveOf(category, { vip: rules.vip, fromJunk: false }),
    usage,
    source: "classified",
  };
}
