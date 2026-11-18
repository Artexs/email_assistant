import {
  addWorkingDays,
  cleanUserText,
  draftPayloadSchema,
  parseToolSwitches,
  sendPayloadFor,
  type DraftPayload,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createPlannedForLoop, type CreatedAction, type PlannedActionInput } from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { getMailboxSettings, lockSettingsForShare } from "../config";
import { getOrganization, isFeatureOn } from "../tenancy";
import { suspiciousThreadKeysOf } from "../triage";

import { FOLLOW_UP_MIN_WAIT_DAYS, loopHooks } from "./hooks";
import { inTransaction, logCommand, mayAct, type LoopCommandDeps, type LoopCommandInput } from "./loop-commands";
import { getLoop, lockLoop, type LoopRow, type LoopVia } from "./repo";

// The user asks for a follow-up of a loop. The command plans one `create_draft` and one `send` that waits
// for a tap (nothing leaves before that), or says why it plans nothing. Telegram and `/api` call it.

export type DraftFollowUpResult =
  | { kind: "planned"; sendId: string }
  | { kind: "would_draft" }
  | { kind: "waiting"; sendId: string }
  | { kind: "closed" }
  | { kind: "limit_reached" }
  | { kind: "too_soon" }
  | { kind: "suspicious" }
  | { kind: "drafts_off" }
  | { kind: "not_allowed" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

// A follow-up send in these states is "waiting": it still can go out. A `rejected`, `expired` or `failed` one is closed:
// a new one may be drafted. (A `failed` send with an unknown outcome may have gone out; the user sees a new card and
// decides.)
export const WAITING_STATUSES = ["awaiting_approval", "approved", "applying"];
const FOLLOW_UP_LIMIT = 2;
const SUBJECT_MAX = 300;

// The subject of the loop as one line of at most 300 characters: no line break, no control character (a header cannot
// be split), and no half of a surrogate pair at the cut (the database refuses it in JSON).
export function oneLineSubject(subject: string | null): string {
  const line = cleanUserText(subject ?? "", { oneLine: true });
  if (line.length <= SUBJECT_MAX) return line;
  const cut = line.slice(0, SUBJECT_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trim();
}

// The recipients of a follow-up come from the loop row only. A `delegated` loop writes to its `counterpart` alone, no Cc
// (the delegate's own side thread stays private). With no counterpart (a data erase cleared it) there is no recipient:
// `to_addresses` may then hold another person, so it is never a fallback.
export function recipientsOf(loop: LoopRow): { to: string[]; cc: string[] } {
  if (loop.kind === "delegated") return { to: loop.counterpart === null ? [] : [loop.counterpart], cc: [] };
  return { to: [...loop.to_addresses], cc: [...loop.cc_addresses] };
}

async function waitingSend(trx: Transaction<DB>, ctx: TenantContext, loopId: string): Promise<string | undefined> {
  const row = await trx
    .selectFrom("actions")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("loop_id", "=", loopId)
    .where("type", "=", "send")
    .where("status", "in", WAITING_STATUSES)
    .orderBy("created_at")
    .orderBy("id")
    .executeTakeFirst();
  return row?.id;
}

// The attempt number of the keys: 1 + the follow-up sends of this loop that already used this `n`. The caller holds the
// loop lock and has found no waiting send, so every one of them is closed.
async function attemptOf(trx: Transaction<DB>, ctx: TenantContext, loopId: string, n: number): Promise<number> {
  const row = await trx
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("loop_id", "=", loopId)
    .where("type", "=", "send")
    .where("idempotency_key", "like", `${loopId}:send:follow_up:${n}:%`)
    .executeTakeFirstOrThrow();
  return Number(row.count) + 1;
}

export type FollowUpVerdict = { kind: "stop"; result: DraftFollowUpResult } | { kind: "go"; n: 1 | 2 };

// The rules 2 to 5 of the stage, on the locked loop.
export async function judgeFollowUp(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loop: LoopRow,
  now: Date
): Promise<FollowUpVerdict> {
  const stop = (result: DraftFollowUpResult): FollowUpVerdict => ({ kind: "stop", result });
  if (loop.status === "closed") return stop({ kind: "closed" });
  if (loop.kind === "promised") return stop({ kind: "not_allowed" });
  const open = await waitingSend(trx, ctx, loop.id);
  if (open !== undefined) return stop({ kind: "waiting", sendId: open });
  if (loop.follow_ups_sent >= FOLLOW_UP_LIMIT) return stop({ kind: "limit_reached" });
  if (loop.follow_ups_sent > 0 && loop.last_follow_up_at !== null) {
    const organization = await getOrganization(trx, ctx);
    const earliest = addWorkingDays(loop.last_follow_up_at, FOLLOW_UP_MIN_WAIT_DAYS, organization?.timezone ?? "UTC");
    if (now.getTime() < earliest.getTime()) return stop({ kind: "too_soon" });
  }
  // Any suspicious reason in the thread stops it, whatever the `suspicious_mail` flag says.
  if ((await suspiciousThreadKeysOf(trx, ctx, loop.mailbox_id, [loop.thread_key])).has(loop.thread_key)) {
    return stop({ kind: "suspicious" });
  }
  return { kind: "go", n: loop.follow_ups_sent === 0 ? 1 : 2 };
}

// The draft of the pair: the loop row and the opening mail (the quote) say everything. A loop whose addresses the draft
// schema refuses (no address left, a hidden character) gives `undefined`: nobody safe to write to.
async function draftOf(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loop: LoopRow,
  n: 1 | 2
): Promise<DraftPayload | undefined> {
  const anchor = await loopHooks().anchorOf(trx, ctx, loop.id);
  if (anchor === undefined) return undefined;
  const { to, cc } = recipientsOf(loop);
  const parsed = draftPayloadSchema.safeParse({
    kind: "follow_up",
    loop_id: loop.id,
    to,
    cc,
    language: loop.language,
    sent_at: anchor.sentAt.toISOString(),
    subject: oneLineSubject(loop.subject),
    quote: anchor.quote,
    n,
  });
  return parsed.success ? parsed.data : undefined;
}

async function auditPlanned(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { loopId: string; actor: string; via: PlanVia; at: Date },
  created: readonly CreatedAction[]
): Promise<void> {
  for (const action of created) {
    await recordAudit(trx, ctx, {
      emailId: null,
      actionId: action.id,
      actor: input.actor,
      event: auditEvents.actionPlanned,
      data: { action_type: action.type, status: action.status, loop_id: input.loopId, via: input.via },
      at: input.at,
    });
  }
}

async function decide(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  input: LoopCommandInput,
  now: Date
): Promise<DraftFollowUpResult> {
  // The settings row first (a setter that turns drafts off waits for this call or this call sees its commit), then the
  // loop, then its sends: the same order as the chaser.
  const hasSettings = (await lockSettingsForShare(trx, ctx, mailboxId)) !== undefined;
  const loop = await lockLoop(trx, ctx, input.loopId);
  if (loop === undefined) return { kind: "not_found" };
  if (!(await mayAct(trx, ctx, input.userId, "owner"))) return { kind: "not_allowed" };
  const verdict = await judgeFollowUp(trx, ctx, loop, now);
  if (verdict.kind === "stop") return verdict.result;

  const settings = hasSettings ? await getMailboxSettings(trx, ctx, mailboxId) : undefined;
  if (settings === undefined) return { kind: "drafts_off" };
  if (settings.mode !== "assist") {
    await recordAudit(trx, ctx, {
      emailId: null,
      actor: input.userId,
      event: auditEvents.loopWouldDraft,
      data: { loop_id: loop.id, kind: loop.kind, via: input.via },
      at: now,
    });
    return { kind: "would_draft" };
  }
  if (!parseToolSwitches(settings.tool_switches).create_draft) return { kind: "drafts_off" };

  const planned = await planFollowUpPair(trx, ctx, loop, verdict.n, { actor: input.userId, via: input.via, now });
  return planned === undefined ? { kind: "not_allowed" } : { kind: "planned", sendId: planned };
}

// Who started the plan. `chaser` is the daily job: the actor of its rows is `system`.
export type PlanVia = LoopVia | "chaser";

// The planning core, shared by the command and the chaser: one `create_draft` and one `send` that waits for a tap. The
// caller holds the locks (the loop; for the command also the settings share lock) and has run `judgeFollowUp`. Returns the
// id of the send, or `undefined` when no safe recipient is left (the schema refuses the loop's addresses): no row is written.
export async function planFollowUpPair(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loop: LoopRow,
  n: 1 | 2,
  input: { actor: string; via: PlanVia; now: Date }
): Promise<string | undefined> {
  const draft = await draftOf(trx, ctx, loop, n);
  if (draft === undefined) return undefined;
  const k = await attemptOf(trx, ctx, loop.id, n);
  const keyOf = (type: string) => `${loop.id}:${type}:follow_up:${n}:${k}`;
  const items: PlannedActionInput[] = [
    {
      type: "create_draft",
      payload: draft,
      status: "ready",
      idempotencyKey: keyOf("create_draft"),
    },
    {
      type: "send",
      payload: sendPayloadFor(draft),
      status: "awaiting_approval",
      idempotencyKey: keyOf("send"),
      dependsOn: "create_draft",
    },
  ];
  const created = await createPlannedForLoop(trx, ctx, loop.id, items);
  const send = created.find((action) => action.type === "send");
  if (send === undefined || created.length !== 2) {
    // The loop is locked and no send of it waits, so the keys of this attempt cannot exist: an invariant break. The throw
    // rolls the transaction back. Never catch it and commit: a half pair or a second pair must not stay.
    throw new HardError("the follow-up keys exist after the loop lock");
  }
  await auditPlanned(trx, ctx, { loopId: loop.id, actor: input.actor, via: input.via, at: input.now }, created);
  return send.id;
}

// True when a follow-up send with this number exists in any state (also `failed` with an unknown outcome, which may have
// gone out). The chaser offers each number once: a card that was rejected or expired is not offered again by the job.
export async function followUpOffered(
  trx: Transaction<DB>,
  ctx: TenantContext,
  loopId: string,
  n: number
): Promise<boolean> {
  return (await attemptOf(trx, ctx, loopId, n)) > 1;
}

// The command. The flag, the loop and the right of the user are read as the stage says: `feature_off`, `not_found`,
// `not_allowed`; then the rules run under the locks.
export async function draftFollowUp(
  deps: LoopCommandDeps,
  ctx: TenantContext,
  input: LoopCommandInput
): Promise<DraftFollowUpResult> {
  if (!(await isFeatureOn(deps.db, ctx, "open_loops"))) return { kind: "feature_off" };
  const known = await getLoop(deps.db, ctx, input.loopId);
  if (known === undefined) return { kind: "not_found" };
  const result = await inTransaction(deps.db, (trx) => decide(trx, ctx, known.mailbox_id, input, deps.now()));
  logCommand(ctx, input.loopId, "follow_up", result.kind, input.via);
  return result;
}
