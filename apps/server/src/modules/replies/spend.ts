import { nextQuotaDayStart, QUOTA_TIMEZONE, quotaDayStart, type LlmRole, type ReplyTrigger } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import type { LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { countLlmCallsSince, recordLlmCall } from "../audit";
import { prompts } from "../triage";

import type { DrafterAttempt } from "./drafter";
import { DRAFTER_MAX_CALLS } from "./drafter";

const log = createLog("replies");

type DbOrTrx = Db | Transaction<DB>;

// An automatic draft waits for the next quota day when the mailbox has used this share of the daily cap (all roles together). A
// tap, a redraft and a sample may use the rest, up to the cap itself.
const AUTO_SHARE_NUM = 4;
const AUTO_SHARE_DEN = 5;

export type CapVerdict =
  // The call may run. `maxCalls` is what the mailbox still has below the cap, at most the two calls of a draft: the cap holds
  // also for the retry.
  | { kind: "ok"; maxCalls: number }
  // An automatic request at or above 80 %: no call; it waits until `until` (the start of the next quota day).
  | { kind: "wait"; until: Date; dayStart: Date }
  // Any request at or above 100 %: no call.
  | { kind: "full"; dayStart: Date };

// The cap reads the `llm.call` rows of the mailbox in the quota day. Every call writes a row, also a failed one, so the count
// is the spend.
export async function capVerdict(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxId: string; trigger: ReplyTrigger; dailyCap: number; now: Date }
): Promise<CapVerdict> {
  const dayStart = quotaDayStart(input.now, QUOTA_TIMEZONE);
  const used = await countLlmCallsSince(db, ctx, input.mailboxId, dayStart);
  // An automatic request waits at 80 %, so it never meets the full cap: it waits there too.
  if (input.trigger === "auto" && used * AUTO_SHARE_DEN >= input.dailyCap * AUTO_SHARE_NUM) {
    return { kind: "wait", until: nextQuotaDayStart(input.now, QUOTA_TIMEZONE), dayStart };
  }
  if (used >= input.dailyCap) return { kind: "full", dayStart };
  return { kind: "ok", maxCalls: Math.min(DRAFTER_MAX_CALLS, input.dailyCap - used) };
}

// One `llm.call` row for each call, in its own commit (before the write of the draft): a crash after the call keeps the
// cost in the count of the cap. A failed audit write is logged and must not hide the answer.
export async function recordAttempts(
  db: DbOrTrx,
  ctx: TenantContext,
  llm: LlmClient,
  input: {
    mailboxId: string;
    emailId: string | null;
    attempts: readonly DrafterAttempt[];
    at: Date;
    // The prompt of the calls; the drafter prompt when left out.
    prompt?: { role: LlmRole; version: string };
  }
): Promise<void> {
  const prompt = input.prompt ?? prompts.drafter;
  for (const attempt of input.attempts) {
    try {
      await recordLlmCall(db, ctx, {
        ...(input.emailId === null ? {} : { emailId: input.emailId }),
        mailboxId: input.mailboxId,
        role: prompt.role,
        promptVersion: prompt.version,
        model: attempt.usage?.model ?? llm.modelOf(prompt.role),
        endpoint: attempt.usage?.endpoint ?? llm.endpointOf(prompt.role),
        provider: attempt.usage?.provider ?? llm.providerOf(prompt.role),
        outcome: attempt.outcome,
        tokensIn: attempt.usage?.tokensIn ?? null,
        tokensOut: attempt.usage?.tokensOut ?? null,
        latencyMs: attempt.latencyMs,
        at: input.at,
      });
    } catch (error) {
      log.with({ org_id: ctx.orgId, mailbox_id: input.mailboxId }).warn("llm_audit_failed", errorFields(error));
    }
  }
}
