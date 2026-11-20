import {
  checkProfileInput,
  profileFallbacks,
  QUOTA_TIMEZONE,
  quotaDayStart,
  resolveReplyStyle,
  SAMPLE_MAIL,
  type ProfileErrorCode,
  type ProfileField,
  type ProfileInput,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { llmErrorCode, type LlmClient } from "../../platform/llm";
import { countMaillessCallsSince } from "../audit";
import { getMailbox, mailboxProfileOf } from "../mail";
import { getOrganization, getOrgOwner } from "../tenancy";
import { prompts } from "../triage";

import { DrafterCallError, draftReply } from "./drafter";
import { capVerdict, recordAttempts } from "./spend";

// At most this many preview calls per mailbox and quota day (the `llm.call` rows of the drafter prompt that belong to no mail).
export const PREVIEW_DAILY_LIMIT = 10;

export interface PreviewDeps {
  db: Db;
  llm: LlmClient;
  /**
   * Whether the provider of the drafter role may get personal data (`LlmProvider.realMail`). The preview sends the profile of the
   * mailbox (names, address, signature, writing style): with `false` it makes no call and answers `llm_off`.
   */
  realMail: boolean;
  // `LLM_DAILY_CAP`: a preview counts in it like a tap, so it stops at 100 %.
  dailyCap: number;
  now(): Date;
}

export type PreviewResult =
  | { kind: "draft"; body: string }
  | { kind: "failed"; reason: string }
  | { kind: "invalid"; field: ProfileField; code: ProfileErrorCode }
  | { kind: "limit" }
  | { kind: "busy" }
  | { kind: "not_found" };

export type StylePreview = (ctx: TenantContext, mailboxId: string, values: ProfileInput) => Promise<PreviewResult>;

/**
 * One drafter call on the fixed sample mail (`SAMPLE_MAIL`: no real mail), with the unsaved values of the card on top of the stored
 * profile (a key that is left out keeps the stored value; an empty string takes the fallback). The call writes `llm.call` rows with
 * no `email_id`: they count in the daily cap like a tap, and the preview limit counts them. Nothing is stored and nothing is sent.
 * The answer passes `checkReplyBody` inside `draftReply`. One preview of a mailbox runs at a time: a second answers `busy`, so a burst
 * cannot pass the limit.
 * The call carries the real profile, so a provider without a sub-processor row (`realMail: false`) gets no preview at all: a fixed
 * profile would not show the owner's own style, and the real one must not leave. The answer is `failed` with `llm_off`, before any read.
 */
export function createStylePreview(deps: PreviewDeps): StylePreview {
  const running = new Set<string>();
  return async (ctx, mailboxId, values) => {
    const checked = checkProfileInput(values);
    if (!checked.ok) return { kind: "invalid", field: checked.field, code: checked.code };
    if (!deps.realMail) return { kind: "failed", reason: "llm_off" };
    const key = `${ctx.orgId}:${mailboxId}`;
    if (running.has(key)) return { kind: "busy" };
    running.add(key);
    try {
      return await run(deps, ctx, mailboxId, checked.fields);
    } finally {
      running.delete(key);
    }
  };
}

async function run(
  deps: PreviewDeps,
  ctx: TenantContext,
  mailboxId: string,
  fields: Partial<Record<ProfileField, string | null>>
): Promise<PreviewResult> {
  const { db } = deps;
  const [mailbox, organization, owner, stored] = await Promise.all([
    getMailbox(db, ctx, mailboxId),
    getOrganization(db, ctx),
    getOrgOwner(db, ctx),
    mailboxProfileOf(db, ctx, mailboxId),
  ]);
  if (mailbox === undefined || organization === undefined) return { kind: "not_found" };

  const now = deps.now();
  const dayStart = quotaDayStart(now, QUOTA_TIMEZONE);
  if ((await countMaillessCallsSince(db, ctx, mailboxId, dayStart, prompts.drafter.version)) >= PREVIEW_DAILY_LIMIT) {
    return { kind: "limit" };
  }
  // A preview counts like a tap: it waits for nothing, and it stops at the cap.
  const cap = await capVerdict(db, ctx, { mailboxId, trigger: "tap", dailyCap: deps.dailyCap, now });
  if (cap.kind !== "ok") return { kind: "failed", reason: "llm_cap" };

  const profile = {
    displayName: fields.displayName === undefined ? (stored?.displayName ?? null) : fields.displayName,
    signature: fields.signature === undefined ? (stored?.signature ?? null) : fields.signature,
    writingStyle: fields.writingStyle === undefined ? (stored?.writingStyle ?? null) : fields.writingStyle,
  };
  const style = resolveReplyStyle(
    profile,
    profileFallbacks({
      ownerName: owner?.displayName ?? null,
      address: mailbox.address,
    })
  );
  // The language of the owner; no owner or no locale reads as Polish.
  const language = owner?.locale === "en" ? "en" : "pl";
  const sample = SAMPLE_MAIL[language];

  try {
    const result = await draftReply(
      deps.llm,
      {
        mail: { ...sample, receivedAt: now },
        style,
        instruction: null,
        language,
        today: now,
        timeZone: organization.timezone,
      },
      { maxCalls: cap.maxCalls }
    );
    await recordAttempts(db, ctx, deps.llm, { mailboxId, emailId: null, attempts: result.attempts, at: deps.now() });
    if (result.kind === "draft") return { kind: "draft", body: result.body };
    if (result.kind === "no_draft") return { kind: "failed", reason: "no_draft" };
    return { kind: "failed", reason: result.reason };
  } catch (error) {
    if (!(error instanceof DrafterCallError)) throw error;
    await recordAttempts(db, ctx, deps.llm, { mailboxId, emailId: null, attempts: error.attempts, at: deps.now() });
    return { kind: "failed", reason: llmErrorCode(error.cause) };
  }
}
