// The pure parts of the waits and picks of the demo recording (`demo/record.spec.ts` does the work): what each wait looks for in an
// API answer, the pick of the delegation that step 7 reminds, and the poll loop with its time-out. Codes and counts only; no mail text
// reaches a message.
import type { ActivityItem, ApprovalItem, DelegationItem, MailboxView, TrustCheck } from "@ea/core/web";

import type { DemoRunPlan } from "./run-plan";
import { DEMO_WAIT_LIMITS_MS } from "./server-env";

export type WaitName = keyof typeof DEMO_WAIT_LIMITS_MS;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `firstSync`: mailbox B has synced once (`lastSyncedAt` set). */
export function firstSynced(
  mailboxes: readonly Pick<MailboxView, "address" | "lastSyncedAt">[],
  address: string
): boolean {
  return mailboxes.some((mailbox) => same(mailbox.address, address) && mailbox.lastSyncedAt !== null);
}

/** `shadowTriaged`: the activity of B holds a row for each of the shadow mails of the plan. */
export function shadowTriaged(
  items: readonly Pick<ActivityItem, "subject">[],
  plan: Pick<DemoRunPlan, "shadow">
): boolean {
  const seen = new Set(items.map((item) => item.subject));
  return plan.shadow.every((mail) => seen.has(mail.subject));
}

/** `historyDone`: `done`, `waiting`, or the code of a check that ended with no result (it never gets better, so the wait stops at once). */
export function historyCheckState(check: Pick<TrustCheck, "status" | "noResultReason"> | null): string {
  if (check === null) return "waiting";
  if (check.status === "done") return "done";
  if (check.status === "no_result") return `demo_history_no_result ${check.noResultReason ?? "unknown"}`;
  return "waiting";
}

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

// The text of a bot message as a reader sees it: no HTML tags, no entities.
const plainOf = (html: string): string =>
  html.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => entities[entity] ?? entity);

/** Some bot message of the chat names the subject: the urgent notice of the mail (`full` detail, the default without the minimal flag). */
export function noticeMentions(botTexts: readonly string[], subject: string): boolean {
  return botTexts.some((text) => plainOf(text).includes(subject));
}

/** The send of the delegation draft that waits for a tap with its Drafts copy made, on mailbox B. */
export function delegationApproval(items: readonly ApprovalItem[], mailboxB: string): ApprovalItem | undefined {
  return items.find(
    (item) =>
      item.delegationId !== null && item.state === "waiting" && item.draftReady && same(item.mailboxAddress, mailboxB)
  );
}

/** The activity row of the undo mail has its move applied and can be undone. */
export function undoRowReady(items: readonly ActivityItem[], plan: Pick<DemoRunPlan, "undo">): boolean {
  return items.some((item) => item.subject === plan.undo.subject && item.undoable && !item.undoPending);
}

export interface AfterTapSnapshot {
  botTexts: readonly string[];
  approvals: readonly ApprovalItem[];
  activity: readonly ActivityItem[];
}

/** `afterTap`: what of the three mails after the tap has not happened yet. Empty means the wait is over. */
export function afterTapMissing(snapshot: AfterTapSnapshot, plan: DemoRunPlan, mailboxB: string): string[] {
  const missing: string[] = [];
  if (!noticeMentions(snapshot.botTexts, plan.urgent.subject)) missing.push("urgent_notice");
  if (delegationApproval(snapshot.approvals, mailboxB) === undefined) missing.push("delegation_send");
  if (!undoRowReady(snapshot.activity, plan)) missing.push("undo_move");
  return missing;
}

/**
 * Step 7 reminds the delegation of the step-6 send (the plan never uses `overdueDelegation`: no seed of this run fills it). The row must be
 * `sent`: only then "Remind now" is on. Undefined when the list has no such row.
 */
export function remindTarget(delegations: readonly DelegationItem[], delegationId: string): DelegationItem | undefined {
  return delegations.find((delegation) => delegation.id === delegationId && delegation.status === "sent");
}

export interface WaitClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const REAL_CLOCK: WaitClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
export const WAIT_POLL_MS = 5000;

/**
 * Polls `probe` until it is true, at most `DEMO_WAIT_LIMITS_MS[what]`. A probe that throws ends the wait with its error. The limit
 * ends with a last probe, then `demo_wait_timeout <what>`.
 */
export async function waitUntil(
  what: WaitName,
  probe: () => Promise<boolean>,
  clock: WaitClock = REAL_CLOCK,
  pollMs: number = WAIT_POLL_MS
): Promise<void> {
  const deadline = clock.now() + DEMO_WAIT_LIMITS_MS[what];
  for (;;) {
    if (await probe()) return;
    const left = deadline - clock.now();
    if (left <= 0) throw new Error(`demo_wait_timeout ${what}`);
    await clock.sleep(Math.min(pollMs, left));
  }
}
