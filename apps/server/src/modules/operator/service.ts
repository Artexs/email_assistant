import {
  costPerMail,
  QUOTA_TIMEZONE,
  quotaDayStart,
  type OperatorFlagBody,
  type OperatorNotices,
  type OperatorOrgDetail,
  type OperatorOrgList,
  type OperatorOrgRow,
  type OperatorPlanBody,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { countFailedSendsSince, lastSendAppliedAt } from "../actions";
import { auditEvents, listAuditEvents, sumLlmCallsByModelSince } from "../audit";
import { countFailedOutboxSince, lastOutboxSentAt, listLinkedChatsOfOrg } from "../channels";
import { listMailboxes } from "../mail";
import { lastDigestSentAt } from "../reports";
import {
  featureStates,
  getOrgPlan,
  listMemberships,
  listOrganizations,
  setOrgFeature,
  setOrgPlan,
  type SetOrgFeatureResult,
  type SetOrgPlanHooks,
  type SetOrgPlanResult,
} from "../tenancy";
import { lastTriageAt } from "../triage";

const DAY_MS = 24 * 3_600_000;

// D18: calls and cost of the quota day. A model without a price adds its calls to `unpricedCalls`.
export async function llmToday(db: Db, ctx: TenantContext, now: Date): Promise<OperatorOrgRow["llmToday"]> {
  const since = quotaDayStart(now, QUOTA_TIMEZONE);
  const rows = await sumLlmCallsByModelSince(db, ctx, since);
  const today = { since: since.toISOString(), calls: 0, costUsd: 0, unpricedCalls: 0 };
  for (const row of rows) {
    today.calls += row.calls;
    const cost = costPerMail(row.model, row.tokensIn, row.tokensOut, now);
    if (cost === null) today.unpricedCalls += row.calls;
    else today.costUsd += cost;
  }
  return today;
}

async function operatorOrgRow(db: Db, orgId: string, now: Date): Promise<OperatorOrgRow | undefined> {
  const ctx: TenantContext = { orgId };
  const since = new Date(now.getTime() - DAY_MS);
  const [plan, members, chats, mailboxes, sends, outbox, llm] = await Promise.all([
    getOrgPlan(db, ctx),
    listMemberships(db, ctx),
    listLinkedChatsOfOrg(db, ctx),
    listMailboxes(db, ctx),
    countFailedSendsSince(db, ctx, since),
    countFailedOutboxSince(db, ctx, since),
    llmToday(db, ctx, now),
  ]);
  // The organization was deleted between the list and its reads: no row.
  if (!plan) return undefined;
  const synced = mailboxes.flatMap((mailbox) => (mailbox.last_synced_at ? [mailbox.last_synced_at.getTime()] : []));
  const count = (status: string) => mailboxes.filter((mailbox) => mailbox.status === status).length;
  return {
    orgId,
    plan: plan.plan,
    trialEndsAt: plan.trialEndsAt?.toISOString() ?? null,
    resumedAt: plan.resumedAt?.toISOString() ?? null,
    maxMailboxes: plan.maxMailboxes,
    members: members.length,
    linkedChats: chats.length,
    mailboxes: {
      total: mailboxes.length,
      active: count("active"),
      paused: count("paused"),
      authError: count("auth_error"),
      hostBlocked: count("host_blocked"),
    },
    lastSyncAt: synced.length > 0 ? new Date(Math.max(...synced)).toISOString() : null,
    failures24h: { sends, outbox },
    llmToday: llm,
  };
}

// D14: one organization after another, each read tenant-scoped. The reads of one organization run together.
export async function listOperatorOrgs(deps: { db: Db; now: () => Date }): Promise<OperatorOrgList> {
  const now = deps.now();
  const orgs: OperatorOrgRow[] = [];
  for (const { id } of await listOrganizations(deps.db)) {
    const row = await operatorOrgRow(deps.db, id, now);
    if (row) orgs.push(row);
  }
  return { orgs, at: now.toISOString() };
}

const NOTICE_LIMIT = 200;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

// D15: one organization, every read tenant-scoped. No address, name or text.
export async function getOperatorOrg(
  deps: { db: Db; now: () => Date },
  orgId: string
): Promise<OperatorOrgDetail | { kind: "not_found" }> {
  const { db } = deps;
  const ctx: TenantContext = { orgId };
  const now = deps.now();
  const since = new Date(now.getTime() - DAY_MS);
  const plan = await getOrgPlan(db, ctx);
  if (!plan) return { kind: "not_found" };
  const [mailboxes, sends, outbox, llm, flags, triage, digest, send, notice] = await Promise.all([
    listMailboxes(db, ctx),
    countFailedSendsSince(db, ctx, since),
    countFailedOutboxSince(db, ctx, since),
    llmToday(db, ctx, now),
    featureStates(db, ctx),
    lastTriageAt(db, ctx),
    lastDigestSentAt(db, ctx),
    lastSendAppliedAt(db, ctx),
    lastOutboxSentAt(db, ctx),
  ]);
  const synced = mailboxes.flatMap((mailbox) => (mailbox.last_synced_at ? [mailbox.last_synced_at.getTime()] : []));
  return {
    orgId,
    plan: plan.plan,
    trialEndsAt: iso(plan.trialEndsAt),
    resumedAt: iso(plan.resumedAt),
    maxMailboxes: plan.maxMailboxes,
    mailboxes: mailboxes.map((mailbox) => ({
      mailboxId: mailbox.id,
      status: mailbox.status,
      statusChangedAt: mailbox.status_changed_at.toISOString(),
      lastSyncedAt: iso(mailbox.last_synced_at),
    })),
    lastRuns: {
      sync: synced.length > 0 ? new Date(Math.max(...synced)).toISOString() : null,
      triage: iso(triage),
      digest: iso(digest),
      send: iso(send),
      notice: iso(notice),
    },
    failures24h: { sends, outbox },
    llmToday: llm,
    flags,
    at: now.toISOString(),
  };
}

// D16: the operator notices of all organizations, newest first (at desc, then orgId), at most 200.
export async function listOperatorNotices(deps: { db: Db; now: () => Date }, days: number): Promise<OperatorNotices> {
  const now = deps.now();
  const since = new Date(now.getTime() - days * DAY_MS);
  const notices: OperatorNotices["notices"] = [];
  for (const { id } of await listOrganizations(deps.db)) {
    const rows = await listAuditEvents(
      deps.db,
      { orgId: id },
      { events: [auditEvents.operatorNotice], since, limit: NOTICE_LIMIT }
    );
    for (const row of rows) {
      // `data` is stored JSON: read it as unknown and skip a row whose kind or key is not a string.
      const data = typeof row.data === "object" && row.data !== null ? (row.data as Record<string, unknown>) : {};
      const { kind, key } = data;
      if (typeof kind !== "string" || typeof key !== "string") continue;
      notices.push({ orgId: id, kind, key, at: row.at.toISOString() });
    }
  }
  notices.sort((a, b) => (a.at === b.at ? a.orgId.localeCompare(b.orgId) : a.at < b.at ? 1 : -1));
  return { notices: notices.slice(0, NOTICE_LIMIT), since: since.toISOString() };
}

// D20: the same service functions as the CLIs; the actor is the operator's user id. The audit rows go into the target organization.
export async function changeOrgPlan(
  deps: { db: Db; now: () => Date; planHooks: SetOrgPlanHooks },
  input: { orgId: string; actor: string; body: OperatorPlanBody }
): Promise<SetOrgPlanResult> {
  return setOrgPlan(
    deps.db,
    { orgId: input.orgId },
    { ...input.body, actor: input.actor, now: deps.now() },
    deps.planHooks
  );
}

export async function changeOrgFlag(
  deps: { db: Db; now: () => Date },
  input: { orgId: string; actor: string; body: OperatorFlagBody }
): Promise<SetOrgFeatureResult> {
  return setOrgFeature(deps.db, { orgId: input.orgId }, { ...input.body, actor: input.actor, now: deps.now() });
}
