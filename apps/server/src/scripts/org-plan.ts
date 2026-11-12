import { resumeHook } from "../composition";
import { cancelPendingOutboxOfOrg } from "../modules/channels";
import { setOrgPlan, type SetOrgPlanResult } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseOrgPlanArgs, usage } from "./org-plan-args";

const log = createLog("org-plan");

const iso = (date: Date | null): string => date?.toISOString() ?? "-";

// Prints ids, codes, dates and counts only. Returns the exit code.
function report(orgId: string, result: SetOrgPlanResult, hookRan: boolean): number {
  switch (result.kind) {
    case "changed": {
      const { before, after } = result;
      const resumed = before.plan === "suspended" && after.plan !== "suspended";
      const cancelled = hookRan
        ? `, cancelled ${result.cancelledMessages} queued messages`
        : resumed
          ? `, expired ${result.expiredSends} sends with an unseen approval request`
          : "";
      log.info(
        `org ${orgId}: plan ${before.plan} → ${after.plan}, max_mailboxes ${before.maxMailboxes} → ${after.maxMailboxes}, trial_ends_at ${iso(after.trialEndsAt)}, resumed_at ${iso(after.resumedAt)}${cancelled}`
      );
      return 0;
    }
    case "unchanged":
      log.info(`org ${orgId}: no change (plan ${result.state.plan}, max_mailboxes ${result.state.maxMailboxes})`);
      return 0;
    case "not_found":
      log.error("organization not found");
      return 1;
    case "trial_days_needed":
      log.error("--trial-days is needed to start a trial");
      return 1;
    case "bad_input":
      log.error(`bad input: ${result.reason}`);
      log.error(usage);
      return 1;
  }
}

async function main(): Promise<number> {
  const args = parseOrgPlanArgs(process.argv.slice(2));
  if (!args) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await setOrgPlan(
      db,
      { orgId: args.orgId },
      { ...args, actor: "cli", now: new Date() },
      { onSuspended: cancelPendingOutboxOfOrg, onResumed: resumeHook(db) }
    );
    return report(
      args.orgId,
      result,
      result.kind === "changed" && result.before.plan !== "suspended" && result.after.plan === "suspended"
    );
  } catch (error) {
    log.error(`failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error(`failed: ${describeError(error)}`);
    process.exit(1);
  });
