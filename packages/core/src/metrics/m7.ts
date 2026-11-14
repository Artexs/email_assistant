// M7: cost per mailbox per month, from the week's LLM calls and the reference numbers of the cost model.
import { costPerMail } from "../triage/cost";
import { costModel } from "./cost-model";

export interface LlmCallRow {
  mailboxId: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  at: Date;
}

export interface UnitCost {
  llmUsdWeek: number;
  llmCalls: number;
  unpricedCalls: number;
  mailboxes: number;
  hostingUsdMonth: number; // per mailbox
  backupUsdMonth: number; // per mailbox
  perMailboxMonthUsd: number;
  targetUsd: number;
}

export function unitCost(rows: readonly LlmCallRow[], opts: { mailboxes: number }): UnitCost {
  let llmUsdWeek = 0;
  let unpricedCalls = 0;
  for (const row of rows) {
    const cost = row.model === null ? null : costPerMail(row.model, row.tokensIn ?? 0, row.tokensOut ?? 0, row.at);
    if (cost === null) unpricedCalls += 1;
    else llmUsdWeek += cost;
  }
  const mailboxes = Math.max(1, opts.mailboxes);
  const hostingUsdMonth = costModel.hostingUsdPerMonth / costModel.mailboxesPerHost;
  const backupUsdMonth = costModel.backupUsdPerMailboxMonth;
  return {
    llmUsdWeek,
    llmCalls: rows.length,
    unpricedCalls,
    mailboxes,
    hostingUsdMonth,
    backupUsdMonth,
    perMailboxMonthUsd: (llmUsdWeek * 30) / 7 / mailboxes + hostingUsdMonth + backupUsdMonth,
    targetUsd: costModel.targetUsdPerMailboxMonth,
  };
}
