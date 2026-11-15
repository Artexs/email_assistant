import { costPerMail, localToInstant } from "@ea/core";

import type { Db } from "../../platform/db";
import { withTenantScope } from "../../platform/db";
import { listLlmCallRows } from "../audit";

import type { LabRun } from "./state";

const DAY_MS = 24 * 3_600_000;

export interface RunSpend {
  // `unpriced`: at least one call has a model with no price. `usd` then holds the priced calls only, a lower bound.
  kind: "ok" | "unpriced";
  usd: number;
  calls: number;
  unpricedCalls: number;
}

// What the run cost so far: the `llm.call` rows of the run organization from the start of the plan, priced with the
// price table of the cost metric. A row with no model or no price is never counted as $0: it makes the result
// `unpriced`, so the serve loop stops the run (`error:unpriced`) and `start` refuses a stack with an unpriced model.
// A null token count (a failed call) is 0, as in the cost metric.
export async function runSpend(db: Db, orgId: string, run: LabRun): Promise<RunSpend> {
  const start = localToInstant(run.plan.startDate, "00:00", "Europe/Warsaw");
  // A day after the tail end: the run writes nothing later, so the bound never hides a call of the run.
  const end = new Date(new Date(run.plan.tailEndsAt).getTime() + DAY_MS);
  const rows = await withTenantScope(orgId, () =>
    listLlmCallRows(db, { orgId }, { range: { start, end }, mailboxId: null })
  );
  let usd = 0;
  let unpricedCalls = 0;
  for (const row of rows) {
    const cost = row.model === null ? null : costPerMail(row.model, row.tokensIn ?? 0, row.tokensOut ?? 0, row.at);
    if (cost === null) unpricedCalls += 1;
    else usd += cost;
  }
  return { kind: unpricedCalls > 0 ? "unpriced" : "ok", usd, calls: rows.length, unpricedCalls };
}
