import { costPerMail, QUOTA_TIMEZONE, quotaDayStart, type OperatorOrgList, type OperatorOrgRow } from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { countFailedSendsSince } from "../actions";
import { sumLlmCallsByModelSince } from "../audit";
import { countFailedOutboxSince, listLinkedChatsOfOrg } from "../channels";
import { listMailboxes } from "../mail";
import { getOrgPlan, listMemberships, listOrganizations } from "../tenancy";

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
