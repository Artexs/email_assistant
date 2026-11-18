import { costPerMail, DAY_MS, localToInstant } from "@ea/core";

import type { Db } from "../../platform/db";
import { listLlmCallRows } from "../audit";

import type { LabRun } from "./state";

export interface RunSpend {
  // `unpriced`: at least one call has a model with no price. `usd` then holds the priced calls only, a lower bound.
  kind: "ok" | "unpriced";
  usd: number;
  calls: number;
  unpricedCalls: number;
}

// The `llm.call` rows of the run organization in the run window: from the start of the plan to a day after the tail end
// (the run writes nothing later, so the bound never hides a call of the run).
async function runCallRows(db: Db, orgId: string, run: LabRun) {
  const start = localToInstant(run.plan.startDate, "00:00", "Europe/Warsaw");
  const end = new Date(new Date(run.plan.tailEndsAt).getTime() + DAY_MS);
  return listLlmCallRows(db, { orgId }, { range: { start, end }, mailboxId: null });
}

// The distinct model ids of those rows, sorted (the report header).
export async function runModels(db: Db, orgId: string, run: LabRun): Promise<string[]> {
  const models = (await runCallRows(db, orgId, run)).flatMap((row) => (row.model === null ? [] : [row.model]));
  return [...new Set(models)].sort();
}

// What the run cost so far: the `llm.call` rows of the run organization from the start of the plan, priced with the
// price table of the cost metric. A row with no model or no price is never counted as $0: it makes the result
// `unpriced`, so the serve loop stops the run (`error:unpriced`) and `start` refuses a stack with an unpriced model.
// A null token count (a failed call) is 0, as in the cost metric.
export async function runSpend(db: Db, orgId: string, run: LabRun): Promise<RunSpend> {
  const rows = await runCallRows(db, orgId, run);
  let usd = 0;
  let unpricedCalls = 0;
  for (const row of rows) {
    const cost =
      row.model === null ? null : costPerMail(row.model, row.tokensIn ?? 0, row.tokensOut ?? 0, row.at, row.endpoint);
    if (cost === null) unpricedCalls += 1;
    else usd += cost;
  }
  return { kind: unpricedCalls > 0 ? "unpriced" : "ok", usd, calls: rows.length, unpricedCalls };
}
