// M4: handled share. How much of the week's mail the assistant dealt with without the user.
import type { Category } from "../triage/categories";

export interface HandledRow {
  emailId: string;
  category: Category; // the latest triage result
  mailboxActionApplied: boolean; // an original move, mark_read or flag action with status applied
  mailboxActionUndone: boolean; // an original mailbox action with status undone
  mailboxActionLogged: boolean; // an original mailbox action with status logged (shadow)
  wrongWithin7Days: boolean; // a "wrong" feedback row created ≤ 7 days after the triage result
  delegationSendApplied: boolean; // a send with payload.kind "delegation", status applied
  delegationCancelled: boolean; // its delegation has status cancelled
}

export interface HandledShare {
  triaged: number;
  handled: number;
  wouldHandle: number;
}

const QUIET_CATEGORIES: readonly Category[] = ["spam", "notification", "info"];

export function handledShare(rows: readonly HandledRow[]): HandledShare {
  let handled = 0;
  let wouldHandle = 0;
  for (const row of rows) {
    const quiet = QUIET_CATEGORIES.includes(row.category) && !row.wrongWithin7Days;
    if (quiet && row.mailboxActionApplied && !row.mailboxActionUndone) handled += 1;
    else if (row.category === "delegation" && row.delegationSendApplied && !row.delegationCancelled) handled += 1;
    if (quiet && row.mailboxActionLogged) wouldHandle += 1;
  }
  return { triaged: rows.length, handled, wouldHandle };
}
