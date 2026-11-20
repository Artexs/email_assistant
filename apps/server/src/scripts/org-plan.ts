import { orgPlanHooks } from "../composition";
import { configureMailHosts } from "../modules/mail";
import { setOrgPlan, type SetOrgPlanResult } from "../modules/tenancy";
import { type CliRawOutput, type CliSpec, runCli } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { cliDescriptions, parseOrgPlanArgs, usage } from "./org-plan-args";

const iso = (date: Date | null): string => date?.toISOString() ?? "-";

// Prints ids, codes, dates and counts only. Returns the exit code.
function report(out: CliRawOutput, orgId: string, result: SetOrgPlanResult, hookRan: boolean): number {
  switch (result.kind) {
    case "changed": {
      const { before, after } = result;
      const resumed = before.plan === "suspended" && after.plan !== "suspended";
      const cancelled = hookRan
        ? `, cancelled ${result.cancelledMessages} queued messages`
        : resumed
          ? `, expired ${result.expiredSends} sends with an unseen approval request`
          : "";
      out.print(
        `org ${orgId}: plan ${before.plan} → ${after.plan}, max_mailboxes ${before.maxMailboxes} → ${after.maxMailboxes}, trial_ends_at ${iso(after.trialEndsAt)}, resumed_at ${iso(after.resumedAt)}${cancelled}`
      );
      return 0;
    }
    case "unchanged":
      out.print(`org ${orgId}: no change (plan ${result.state.plan}, max_mailboxes ${result.state.maxMailboxes})`);
      return 0;
    case "not_found":
      out.fail("organization not found");
      return 1;
    case "trial_days_needed":
      out.fail("--trial-days is needed to start a trial");
      return 1;
    case "bad_input":
      out.fail(`bad input: ${result.reason}`);
      out.fail(`usage: ${usage}`);
      return 1;
  }
}

const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOrgPlanArgs(argv);

  const config = loadConfig();
  // The resume hook can reach mail code; without a policy the guard refuses local hosts.
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await setOrgPlan(
      db,
      { orgId: args.orgId },
      { ...args, actor: "cli", now: new Date() },
      orgPlanHooks(db)
    );
    return report(
      out,
      args.orgId,
      result,
      result.kind === "changed" && result.before.plan !== "suspended" && result.after.plan === "suspended"
    );
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "org-plan", descriptions: cliDescriptions, main });
}
