import {
  buildStyleSamples,
  DAY_MS,
  profileFallbacks,
  QUOTA_TIMEZONE,
  quotaDayStart,
  resolveReplyStyle,
  STYLE_MAX_SOURCES,
  STYLE_MIN_SAMPLES,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import type { LlmClient } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { auditEvents, countMailboxOutcomesSince, recordAudit } from "../audit";
import { getMailbox, getSentSyncState, listStyleSources, mailboxProfileOf } from "../mail";
import { getOrganization, getOrgOwner, isFeatureOn } from "../tenancy";
import { prompts } from "../triage";

import type { ReplyLlmScope } from "./draft-one";
import { capVerdict, recordAttempts } from "./spend";
import { StylistCallError, suggestStyle } from "./stylist";

const log = createLog("replies");

// At most this many suggestion runs with a model call per mailbox and quota day.
export const STYLE_SUGGEST_DAILY_LIMIT = 3;
// The sent mail that a suggestion reads: the last 14 days.
export const STYLE_SUGGEST_WINDOW_MS = 14 * DAY_MS;

// The outcomes of a run that made a model call: they count in the day limit. The others made no call.
const CALL_OUTCOMES = ["suggestion", "checks", "output", "provider"] as const;

export interface StyleSuggestDeps {
  db: Db;
  llm: LlmClient;
  // `LLM_DAILY_CAP`: a run counts in it like a tap, so it stops at 100 %.
  dailyCap: number;
  now(): Date;
  /**
   * Whether the provider of the stylist role may get personal data (`LlmProvider.realMail`). The sent text is real mail: with
   * `false` the run makes no call, reads no sent mail and answers `llm_off`.
   */
  realMail: boolean;
  // The LLM scope of the reply drafts: under `synthetic` only test mail is read.
  scope: ReplyLlmScope;
}

export type StyleSuggestFailure = "llm_off" | "llm_cap" | "checks" | "output" | "provider";

export type StyleSuggestResult =
  | { kind: "suggestion"; text: string; count: number }
  | { kind: "failed"; reason: StyleSuggestFailure }
  | { kind: "sent_off" }
  | { kind: "too_few"; count: number }
  | { kind: "blocked"; reason: "oauth_mailbox" }
  | { kind: "limit" }
  | { kind: "busy" }
  | { kind: "not_found" };

export type StyleSuggest = (
  ctx: TenantContext,
  mailboxId: string,
  by: { userId: string; language: "pl" | "en" | null }
) => Promise<StyleSuggestResult>;

/**
 * One suggestion of a writing style from the sent mail of one mailbox: the stored sent texts of the last 14 days go through the
 * cut (`buildStyleSamples`) to one `stylist` call, and the answer is the text. Nothing is stored but the audit row
 * `mailbox.style_suggested` (outcome and counts, never a text) and the `llm.call` rows. Answers, in this order: no such mailbox
 * `not_found`; an OAuth mailbox `blocked`; sent tracking off `sent_off`; three runs with a call today `limit`; a run in progress
 * `busy`; a provider with no sub-processor row `failed` / `llm_off` (before any read of mail); fewer than `STYLE_MIN_SAMPLES`
 * samples `too_few` (no call); the daily cap used up `failed` / `llm_cap`. The switch is read again after the call: a user who
 * turned it off during the call gets `sent_off` and no text.
 * The lock comes before the limit read, so that two requests at the limit cannot both pass it.
 */
export function createStyleSuggestion(deps: StyleSuggestDeps): StyleSuggest {
  const running = new Set<string>();
  return async (ctx, mailboxId, by) => {
    const { db } = deps;
    const mailbox = await getMailbox(db, ctx, mailboxId);
    if (mailbox === undefined) return { kind: "not_found" };
    if (mailbox.oauth_provider !== null) return { kind: "blocked", reason: "oauth_mailbox" };
    const row = (outcome: string, count: number) => auditRow(deps, ctx, mailboxId, by.userId, outcome, count);
    if (!(await sentTrackingOn(db, ctx, mailboxId))) {
      await row("sent_off", 0);
      return { kind: "sent_off" };
    }

    const key = `${ctx.orgId}:${mailboxId}`;
    if (running.has(key)) return { kind: "busy" };
    running.add(key);
    try {
      const dayStart = quotaDayStart(deps.now(), QUOTA_TIMEZONE);
      const used = await countMailboxOutcomesSince(
        db,
        ctx,
        auditEvents.mailboxStyleSuggested,
        mailboxId,
        dayStart,
        CALL_OUTCOMES
      );
      if (used >= STYLE_SUGGEST_DAILY_LIMIT) return { kind: "limit" };
      if (!deps.realMail) {
        await row("llm_off", 0);
        return { kind: "failed", reason: "llm_off" };
      }
      return await run(deps, ctx, mailbox, by, row);
    } finally {
      running.delete(key);
    }
  };
}

type Row = (outcome: string, count: number) => Promise<void>;

async function run(
  deps: StyleSuggestDeps,
  ctx: TenantContext,
  mailbox: { id: string; address: string },
  by: { userId: string; language: "pl" | "en" | null },
  row: Row
): Promise<StyleSuggestResult> {
  const { db } = deps;
  const mailboxId = mailbox.id;
  const now = deps.now();
  const requestLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });

  const [organization, owner, stored] = await Promise.all([
    getOrganization(db, ctx),
    getOrgOwner(db, ctx),
    mailboxProfileOf(db, ctx, mailboxId),
  ]);
  if (organization === undefined) return { kind: "not_found" };
  // The signature that the cut removes is the one a draft ends with: the stored one, else the fallbacks of the drafter.
  const { signature } = resolveReplyStyle(
    stored,
    profileFallbacks({
      ownerName: owner?.displayName ?? null,
      address: mailbox.address,
    })
  );
  const sources = await listStyleSources(db, ctx, mailboxId, {
    since: new Date(now.getTime() - STYLE_SUGGEST_WINDOW_MS),
    limit: STYLE_MAX_SOURCES,
    testOnly: deps.scope.kind === "synthetic" ? deps.scope.testMail : null,
  });
  const { samples, names } = buildStyleSamples(sources, { signature });
  const count = samples.length;
  if (count < STYLE_MIN_SAMPLES) {
    await row("too_few", count);
    return { kind: "too_few", count };
  }

  // A run counts like a tap: it waits for nothing, and it stops at the cap.
  const cap = await capVerdict(db, ctx, { mailboxId, trigger: "tap", dailyCap: deps.dailyCap, now });
  if (cap.kind !== "ok") {
    await row("llm_cap", count);
    return { kind: "failed", reason: "llm_cap" };
  }

  const language = by.language === "en" ? "en" : "pl";
  const record = (attempts: Parameters<typeof recordAttempts>[3]["attempts"]) =>
    recordAttempts(db, ctx, deps.llm, {
      mailboxId,
      emailId: null,
      attempts,
      at: deps.now(),
      prompt: prompts.stylist,
    });

  let result;
  try {
    result = await suggestStyle(deps.llm, { samples, names, language }, { maxCalls: cap.maxCalls });
  } catch (error) {
    if (!(error instanceof StylistCallError)) throw error;
    await record(error.attempts);
    await row("provider", count);
    requestLog.warn("style_suggest_failed", { reason: "provider", count, ...errorFields(error.cause) });
    return { kind: "failed", reason: "provider" };
  }
  await record(result.attempts);

  // The user can turn the switch off while the model works: the text is dropped.
  if (!(await sentTrackingOn(db, ctx, mailboxId))) {
    await row("sent_off", count);
    return { kind: "sent_off" };
  }
  if (result.kind === "failed") {
    await row(result.reason, count);
    requestLog.warn("style_suggest_failed", { reason: result.reason, count });
    return { kind: "failed", reason: result.reason };
  }
  await row("suggestion", count);
  requestLog.info("style_suggested", { count });
  return { kind: "suggestion", text: result.text, count };
}

// Sent tracking is on: the organization flag `sent_sync` and the switch of the mailbox.
async function sentTrackingOn(db: Db, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  if (!(await isFeatureOn(db, ctx, "sent_sync"))) return false;
  return (await getSentSyncState(db, ctx, mailboxId))?.enabled === true;
}

// One audit row for each run that reaches an outcome with a count; never a text.
async function auditRow(
  deps: StyleSuggestDeps,
  ctx: TenantContext,
  mailboxId: string,
  userId: string,
  outcome: string,
  count: number
): Promise<void> {
  await recordAudit(deps.db, ctx, {
    actor: userId,
    event: auditEvents.mailboxStyleSuggested,
    data: { mailbox_id: mailboxId, count, outcome, via: "web" },
    at: deps.now(),
  });
}
