import { SimFileError } from "../../platform/sim-files";
import { isSentCommand, type SimCommand } from "../sim-args";

import { fail, type SimResult } from "./sim-corpus-load";
import { auditApply, auditList, freeze } from "./sim-freeze";
import { blindExport, labelImport, reconcile, stale } from "./sim-labels";
import { brief, check, plan, status } from "./sim-report";
import { runSentSim } from "./sim-sent-commands";

// The result type and the blind hash live in `sim-corpus-load.ts`; callers keep importing them from here.
export { blindHash, type SimResult } from "./sim-corpus-load";

export async function runSim(cmd: SimCommand): Promise<SimResult> {
  try {
    if (isSentCommand(cmd)) return runSentSim(cmd);
    switch (cmd.kind) {
      case "plan":
        return plan(cmd);
      case "status":
        return await status(cmd);
      case "brief":
        return brief(cmd);
      case "check":
        return await check(cmd);
      case "blind-export":
        return await blindExport(cmd);
      case "label-import":
        return await labelImport(cmd);
      case "stale":
        return await stale(cmd);
      case "reconcile":
        return await reconcile(cmd);
      case "freeze":
        return await freeze(cmd);
      case "audit-list":
        return await auditList(cmd);
      case "audit-apply":
        return await auditApply(cmd);
    }
  } catch (error) {
    if (error instanceof SimFileError) return fail(error.message);
    throw error;
  }
}
