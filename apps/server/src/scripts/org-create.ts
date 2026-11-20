import { DAY_MS } from "@ea/core";

import { createOrganizationWithOwner } from "../modules/tenancy";
import { type CliSpec, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { cliDescriptions, parseOrgCreateArgs } from "./org-create-args";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOrgCreateArgs(argv);
  const { plan, ...organization } = args;

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const planInput =
      plan.kind === "trial"
        ? ({ kind: "trial", endsAt: new Date(Date.now() + plan.trialDays * DAY_MS) } as const)
        : plan;
    const { orgId, userId } = await createOrganizationWithOwner(db, { ...organization, plan: planInput });
    const trialEndsAt = planInput.kind === "trial" ? planInput.endsAt.toISOString() : "-";
    out.print(`created org ${orgId} user ${userId} plan ${planInput.kind} trial_ends_at ${trialEndsAt}`);
    return 0;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    out.fail("user with this email already exists");
    return 1;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "org-create", descriptions: cliDescriptions, main });
}
