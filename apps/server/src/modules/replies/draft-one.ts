import {
  type DrafterInput,
  MINUTE_MS,
  profileFallbacks,
  replyEligibility,
  type ReplyLanguage,
  resolveReplyStyle,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { configCodes, llmErrorCode, softCodes, type LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { findSendByKey, getSend } from "../actions";
import type { MailboxProfile, TestMailRule } from "../mail";
import type { LlmPause } from "../triage";

import { DrafterCallError, draftReply } from "./drafter";
import { loadReplyFacts } from "./facts";
import {
  finishReplyRequest,
  releaseReplyRequest,
  type ReplyRequestEnd,
  triggerOf,
  type ReplyRequestRow,
} from "./repo/requests";
import { isTestMail, readMailTextForDraft } from "./repo/scan";
import { capVerdict, recordAttempts } from "./spend";
import { replyDraftPayload, writeReplyDraft, type WriteDeps } from "./write";

const log = createLog("replies");

// A hard error or a failed write counts a try; the third ends the request.
export const MAX_TRIES = 3;
const RETRY_WAIT_MS = 5 * MINUTE_MS;
// A request that a user waits for (a tap, a redraft, a sample) ends here when it is not done.
export const USER_REQUEST_TIMEOUT_MS = 10 * MINUTE_MS;

// `synthetic`: only test mail goes to the model. `all`: every mail.
export type ReplyLlmScope = { kind: "synthetic"; testMail: TestMailRule } | { kind: "all" };

export interface DraftDeps extends WriteDeps {
  llm: LlmClient;
  pause: LlmPause;
  scope: ReplyLlmScope;
  // `LLM_DAILY_CAP`: the calls of a mailbox in one quota day, all roles together.
  dailyCap: number;
  now(): Date;
  // The operator notice of a reached cap, never awaited.
  onCapReached?: (ctx: TenantContext, mailboxId: string, dayStart: Date) => void;
}

// What the run reads once for a mailbox.
export interface MailboxEnv {
  mailboxId: string;
  address: string;
  oauth: boolean;
  timezone: string;
  // `organizations.style_text`: the signature of a mailbox that has none of its own.
  orgStyleText: string | null;
  owner: { displayName: string; locale: ReplyLanguage | null } | undefined;
  profile: MailboxProfile | null;
  // The gates at the start of the run. The write step reads them again under the lock.
  flagOn: boolean;
  assist: boolean;
  switchOn: boolean;
}

export type DraftOutcome = "done" | "no_draft" | "failed" | "cancelled" | "superseded" | "waiting" | "retry" | "lost";

// The style that the prompt gets: the same name and signature that the message builder uses at send time (profile, then the
// organization text, then the owner name), so the texts that the checks allow are the texts that go out.
function styleOf(env: MailboxEnv): DrafterInput["style"] {
  return resolveReplyStyle(
    env.profile,
    profileFallbacks({
      ownerName: env.owner?.displayName ?? null,
      address: env.address,
      orgStyleText: env.orgStyleText,
    })
  );
}

// Drafts one claimed request, or ends or releases it. The request is `drafting` with `row.locked_at` (the token) when this runs;
// every write of the request compares the token. Throws only on a database error or a bug: the job releases the request with a
// counted try.
export async function draftOne(
  deps: DraftDeps,
  ctx: TenantContext,
  env: MailboxEnv,
  row: ReplyRequestRow,
  warnedCap: Set<string>
): Promise<DraftOutcome> {
  const lockedAt = row.locked_at;
  if (lockedAt === null) return "lost";
  const trigger = triggerOf(row);
  const now = deps.now();
  const requestLog = log.with({
    org_id: ctx.orgId,
    mailbox_id: env.mailboxId,
    email_id: row.email_id,
    reply_request_id: row.id,
  });

  const end = async (
    status: ReplyRequestEnd,
    reasonCode: string | null,
    outcome: DraftOutcome,
    extra: { sendActionId?: string; sampleBody?: string } = {}
  ): Promise<DraftOutcome> => {
    const finished = await finishReplyRequest(deps.db, ctx, row.id, lockedAt, {
      status,
      reasonCode,
      ...extra,
      now,
    });
    return finished ? outcome : "lost";
  };
  const fail = async (code: string): Promise<DraftOutcome> => {
    const outcome = await end("failed", code, "failed");
    if (outcome === "failed") requestLog.warn("reply_draft_failed", { error_code: code });
    return outcome;
  };
  const release = (nextAttemptAt: Date, countAttempt: boolean) =>
    releaseReplyRequest(deps.db, ctx, row.id, lockedAt, { nextAttemptAt, countAttempt, now });

  // A user waits for a tap, a redraft or a sample: after 10 minutes it ends, whatever stopped it.
  if (trigger !== "auto" && now.getTime() - row.created_at.getTime() >= USER_REQUEST_TIMEOUT_MS) {
    return fail("timeout");
  }
  // A stale take-back counted a try. A request that reached the limit this way gets no more model call.
  if (row.attempts >= MAX_TRIES) return fail("llm_error");

  // A stored result: the pair of this request exists. Nothing new is drafted and nothing is paid.
  if (trigger === "auto" || trigger === "tap") {
    const stored = await findSendByKey(deps.db, ctx, `${row.id}:send`);
    if (stored !== undefined) return end("done", null, "done", { sendActionId: stored.id });
  }

  // A redraft replaces a waiting send. A send that does not wait any more (sent, rejected, replaced, expired) ends the request
  // before the call: the model would be paid for a text with no place to go. The write step checks again under the lock.
  if (trigger === "redraft") {
    const previous = row.previous_send_id === null ? undefined : await getSend(deps.db, ctx, row.previous_send_id);
    if (previous === undefined || previous.status !== "awaiting_approval")
      return end("cancelled", "closed", "cancelled");
  }

  // The checks that need no model.
  const loaded = (await loadReplyFacts(deps.db, ctx, [row.email_id], { ownerLocale: env.owner?.locale ?? null })).get(
    row.email_id
  );
  if (loaded === undefined) return end("cancelled", "mail_gone", "cancelled");
  if (!env.flagOn) return end("cancelled", "feature_off", "cancelled");
  // A sample is not saved in Drafts and needs neither the mode nor the switch.
  if (trigger !== "sample") {
    if (!env.assist) return end("cancelled", "not_assist", "cancelled");
    if (!env.switchOn) return end("cancelled", "switch_off", "cancelled");
  }
  if (env.oauth) return end("cancelled", "oauth_mailbox", "cancelled");
  const verdict = replyEligibility(loaded.facts, { trigger, now });
  if (!verdict.ok) return end("cancelled", verdict.reason, "cancelled");
  // The same scope as the triage: under `synthetic`, a real mail never goes to the model.
  if (deps.scope.kind === "synthetic" && !(await isTestMail(deps.db, ctx, row.email_id, deps.scope.testMail))) {
    return end("cancelled", "llm_scope", "cancelled");
  }
  const text = await readMailTextForDraft(deps.db, ctx, row.email_id);
  const fromAddress = loaded.mail.fromAddress;
  if (text === undefined || fromAddress === null) return end("cancelled", "mail_gone", "cancelled");
  // A recipient that the draft schema refuses (a hidden character, a second address) never gets a draft. Checked before the call.
  if (
    trigger !== "sample" &&
    replyDraftPayload({ request: row, lockedAt, body: "x", language: verdict.language, fromAddress, now }) === undefined
  ) {
    return end("cancelled", "bad_recipient", "cancelled");
  }
  // No stored text (retention cleared it): the model would answer a mail that it cannot read.
  if (text.bodyText === null || text.bodyText.trim() === "") return end("no_draft", "no_text", "no_draft");

  // The cap: the calls of the mailbox in the quota day.
  const cap = await capVerdict(deps.db, ctx, {
    mailboxId: env.mailboxId,
    trigger,
    dailyCap: deps.dailyCap,
    now,
  });
  if (cap.kind !== "ok") {
    const dayStart = cap.dayStart.toISOString();
    if (!warnedCap.has(`${env.mailboxId}:${dayStart}`)) {
      warnedCap.add(`${env.mailboxId}:${dayStart}`);
      requestLog.warn("llm_daily_cap_reached", { count: deps.dailyCap, day_start: dayStart });
      deps.onCapReached?.(ctx, env.mailboxId, cap.dayStart);
    }
    // An automatic request waits for the next quota day (no try counted). Any other request fails at once: the user waits.
    if (cap.kind === "wait") return (await release(cap.until, false)) ? "waiting" : "lost";
    return fail("llm_cap");
  }

  const style = styleOf(env);
  const input: DrafterInput = {
    mail: {
      subject: text.subject,
      fromName: text.fromName,
      fromAddress,
      receivedAt: loaded.mail.receivedAt,
      body: text.bodyText,
    },
    style,
    instruction: row.instruction,
    language: verdict.language,
    today: now,
    timeZone: env.timezone,
  };

  let result: Awaited<ReturnType<typeof draftReply>>;
  try {
    result = await draftReply(deps.llm, input, { maxCalls: cap.maxCalls });
  } catch (error) {
    if (!(error instanceof DrafterCallError)) throw error;
    await recordAttempts(deps.db, ctx, deps.llm, {
      mailboxId: env.mailboxId,
      emailId: row.email_id,
      attempts: error.attempts,
      at: deps.now(),
    });
    return handleCallError(deps, row, error, { end, fail, release, now, requestLog });
  }
  // One row for each call, in its own commit: a crash from here on keeps the cost in the count of the cap.
  await recordAttempts(deps.db, ctx, deps.llm, {
    mailboxId: env.mailboxId,
    emailId: row.email_id,
    attempts: result.attempts,
    at: deps.now(),
  });
  deps.pause.reset();

  if (result.kind === "no_draft") return end("no_draft", result.reason, "no_draft");
  if (result.kind === "failed") return fail(result.reason);
  if (trigger === "sample") return end("done", null, "done", { sampleBody: result.body });

  const written = await writeReplyDraft(deps, ctx, {
    request: row,
    lockedAt,
    body: result.body,
    language: verdict.language,
    fromAddress,
    now: deps.now(),
  });
  switch (written.kind) {
    case "written":
    case "exists":
      requestLog.info("reply_drafted", { action_id: written.sendId, count: row.attempts });
      return "done";
    case "superseded":
      requestLog.info("reply_superseded", { reason: "open_newer" });
      return "superseded";
    case "cancelled":
      return "cancelled";
    case "lost":
      return "lost";
  }
}

interface ErrorEnds {
  end: (
    status: ReplyRequestEnd,
    reasonCode: string | null,
    outcome: DraftOutcome,
    extra?: { sendActionId?: string }
  ) => Promise<DraftOutcome>;
  fail: (code: string) => Promise<DraftOutcome>;
  release: (nextAttemptAt: Date, countAttempt: boolean) => Promise<boolean>;
  now: Date;
  requestLog: ReturnType<typeof log.with>;
}

// A provider error. The quota or the service (soft) and a wrong key or model (config) are not about the mail: the request goes
// back in 5 minutes with no try counted, and the pause of the job stops the other requests. A hard error and a timeout count a
// try; the third ends the request.
async function handleCallError(
  deps: DraftDeps,
  row: ReplyRequestRow,
  error: DrafterCallError,
  ends: ErrorEnds
): Promise<DraftOutcome> {
  const code = llmErrorCode(error.cause);
  const retryAt = new Date(ends.now.getTime() + RETRY_WAIT_MS);
  // A timeout counts as a try, as in the Sent analysis: one mail can time out on every call, so it must end after the try limit
  // (a mail that always times out must not retry for 7 days). Other soft errors are about the service, not the mail.
  const soft = code !== "timeout" && (softCodes as readonly string[]).includes(code);
  if (soft || (configCodes as readonly string[]).includes(code)) {
    deps.pause.trip(soft ? "soft" : "config", code, ends.now);
    if (!soft) ends.requestLog.error("reply_llm_config_error", { error_code: code });
    return (await ends.release(retryAt, false)) ? "retry" : "lost";
  }
  if (row.attempts + 1 >= MAX_TRIES) return ends.fail("llm_error");
  return (await ends.release(retryAt, true)) ? "retry" : "lost";
}

// A database error or a bug after the claim: the request goes back with a counted try; the third ends it.
export async function recoverRequest(
  deps: DraftDeps,
  ctx: TenantContext,
  mailboxId: string,
  row: ReplyRequestRow,
  error: unknown
): Promise<void> {
  const lockedAt = row.locked_at;
  const requestLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId, reply_request_id: row.id });
  requestLog.error("reply_draft_error", errorFields(error));
  if (lockedAt === null) return;
  const now = deps.now();
  try {
    if (row.attempts + 1 >= MAX_TRIES) {
      if (await finishReplyRequest(deps.db, ctx, row.id, lockedAt, { status: "failed", reasonCode: "internal", now })) {
        requestLog.warn("reply_draft_failed", { error_code: "internal" });
      }
      return;
    }
    await releaseReplyRequest(deps.db, ctx, row.id, lockedAt, {
      nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
      countAttempt: true,
      now,
    });
  } catch (releaseError) {
    // The row stays `drafting`: the stale take-back finds it and counts the try.
    requestLog.error("reply_release_failed", errorFields(releaseError));
  }
}
