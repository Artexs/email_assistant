import { parseToolSwitches } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import {
  closeSend,
  listMailboxesWithOpenReplySends,
  listSweepReplySends,
  type ApprovalHooks,
  type DelegationHooks,
  type SweepReplySend,
} from "../actions";
import { getMailboxSettings } from "../config";
import { listSyncTargets, newerMailInThread, replyFactsOf, type MailReplyFacts } from "../mail";
import { isFeatureOn, isOrgSuspended } from "../tenancy";
import { suspiciousReasonsOf } from "../triage";

import { lockThread } from "./write";

const log = createLog("replies");

// One run closes at most this many open reply sends over all mailboxes. Only closes count against it: a send that stays open costs nothing.
export const SWEEP_LIMIT = 200;
// One run also lists at most this many open reply sends over all mailboxes, so a run stays short.
export const SWEEP_LIST_LIMIT = 1000;

// Why the sweep closes an open reply. The order is the order of the checks.
export const sweepReasons = ["answered", "newer_mail", "original_moved", "suspicious", "policy_changed"] as const;
export type SweepReason = (typeof sweepReasons)[number];

export interface SweepDeps {
  db: Db | Transaction<DB>;
  hooks: DelegationHooks;
  // The cards of a closed send lose their buttons (the composition root passes the real hook).
  approvalHooks: ApprovalHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  now(): Date;
  // Closes per run (default `SWEEP_LIMIT`) and listed sends per run (default `SWEEP_LIST_LIMIT`), over all mailboxes. Only a test sets them.
  closeLimit?: number;
  listLimit?: number;
}

export interface SweepResult {
  mailboxes: number;
  mailboxErrors: number;
  // Open reply sends that the sweep listed.
  checked: number;
  closed: Record<SweepReason, number>;
  // A send that a run held, or that a tap, a send or another close took first: left alone.
  skipped: number;
}

const emptyResult = (): SweepResult => ({
  mailboxes: 0,
  mailboxErrors: 0,
  checked: 0,
  closed: { answered: 0, newer_mail: 0, original_moved: 0, suspicious: 0, policy_changed: 0 },
  skipped: 0,
});

// What one run may still do: closes and listed sends.
interface Budget {
  closeLeft: number;
  listLeft: number;
}

interface MailboxFacts {
  // Mode `assist` and the switch `reply_drafts` of the mailbox are both on.
  policyOpen: boolean;
}

// The reason to close one open reply, or null. DB facts only: no mailbox is read. Newer mail is the only check that costs a query, so
// it runs after the cheap checks.
async function reasonOf(
  deps: SweepDeps,
  ctx: TenantContext,
  send: SweepReplySend,
  mail: MailReplyFacts,
  suspicious: boolean,
  mailbox: MailboxFacts
): Promise<SweepReason | null> {
  if (mail.answered) return "answered";
  if (await newerMailInThread(deps.db, ctx, send.emailId)) return "newer_mail";
  // A move that the assistant made (`moved_at` set) does not count: the user did not move the mail.
  if (send.draftFolder !== null && mail.folder !== send.draftFolder && mail.movedAt === null) return "original_moved";
  if (suspicious) return "suspicious";
  if (!mailbox.policyOpen) return "policy_changed";
  return null;
}

// One close, one transaction: the lock of the thread (the drafter takes it too), then the shared close. A waiting send closes
// with no result notice; a send that the user tapped (`approved` when the close locks it) gets one, because that user waits for a result.
async function closeOne(
  deps: SweepDeps,
  ctx: TenantContext,
  mailboxId: string,
  send: SweepReplySend,
  threadKey: string,
  reason: SweepReason
): Promise<boolean> {
  const now = deps.now();
  const run = async (trx: Transaction<DB>): Promise<boolean> => {
    await lockThread(trx, ctx, mailboxId, threadKey);
    const closed = await closeSend(trx, ctx, {
      sendId: send.sendId,
      reason,
      // Decided from the row that the close locks: a tap may land between the list and the close.
      notify: "approved",
      claimed: false,
      now,
      deps: { hooks: deps.hooks, approvalHooks: deps.approvalHooks, uidplus: deps.uidplus },
    });
    return closed.kind === "closed";
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}

// `replies.sweep` (every 5 minutes): closes the open reply sends whose reason to exist ended. It reads no mailbox. Flag `reply_drafts`
// off: it does nothing (the committer holds reply sends and the expiry job ends them). A suspended organization is skipped.
export function createReplySweep(deps: SweepDeps): {
  run(opts?: { mailboxIds?: readonly string[] }): Promise<SweepResult>;
} {
  async function sweepMailbox(
    ctx: TenantContext,
    mailboxId: string,
    total: SweepResult,
    budget: Budget
  ): Promise<void> {
    if (!(await isFeatureOn(deps.db, ctx, "reply_drafts"))) return;
    const sends = await listSweepReplySends(deps.db, ctx, mailboxId, { limit: budget.listLeft });
    if (sends.length === 0) return;
    const settings = await getMailboxSettings(deps.db, ctx, mailboxId);
    // No settings row: the mailbox is going away; leave its sends to the expiry job.
    if (settings === undefined) return;
    const mailbox: MailboxFacts = {
      policyOpen: settings.mode === "assist" && parseToolSwitches(settings.tool_switches).reply_drafts,
    };
    budget.listLeft -= sends.length;
    total.checked += sends.length;
    const ids = sends.map((send) => send.emailId);
    const mails = await replyFactsOf(deps.db, ctx, ids);
    const suspicious = await suspiciousReasonsOf(deps.db, ctx, ids);
    const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
    for (const send of sends) {
      if (budget.closeLeft <= 0) return;
      const mail = mails.get(send.emailId);
      // The mail of the send is gone or belongs to another mailbox: nothing to decide on.
      if (mail === undefined || mail.mailboxId !== mailboxId) continue;
      try {
        const reason = await reasonOf(deps, ctx, send, mail, suspicious.has(send.emailId), mailbox);
        if (reason === null) continue;
        if (await closeOne(deps, ctx, mailboxId, send, mail.threadKey, reason)) {
          total.closed[reason] += 1;
          budget.closeLeft -= 1;
          mailboxLog.info("reply_closed", { action_id: send.sendId, reason });
        } else {
          total.skipped += 1;
        }
      } catch (error) {
        // The error of one send does not stop the next.
        mailboxLog.warn("reply_sweep_failed", { action_id: send.sendId, ...errorFields(error) });
      }
    }
  }

  return {
    async run(opts) {
      const total = emptyResult();
      const budget: Budget = {
        closeLeft: deps.closeLimit ?? SWEEP_LIMIT,
        listLeft: deps.listLimit ?? SWEEP_LIST_LIMIT,
      };
      // The mailboxes that the sync visits (active, organization not suspended), and among them those with an open reply send: the
      // mailbox with the oldest open send first. A mailbox with nothing to sweep costs nothing.
      const visited = new Set((await listSyncTargets(deps.db)).map((target) => target.mailboxId));
      const targets = await listMailboxesWithOpenReplySends(deps.db);
      for (const { orgId, mailboxId } of targets) {
        if (budget.closeLeft <= 0 || budget.listLeft <= 0) break;
        if (!visited.has(mailboxId)) continue;
        if (opts?.mailboxIds !== undefined && !opts.mailboxIds.includes(mailboxId)) continue;
        const ctx = { orgId };
        try {
          if (await isOrgSuspended(deps.db, ctx)) continue;
          total.mailboxes += 1;
          await sweepMailbox(ctx, mailboxId, total, budget);
        } catch (error) {
          total.mailboxErrors += 1;
          log.with({ org_id: orgId, mailbox_id: mailboxId }).error("replies_mailbox_failed", errorFields(error));
        }
      }
      return total;
    },
  };
}
