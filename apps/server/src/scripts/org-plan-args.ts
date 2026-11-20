import { parseArgs } from "node:util";

import { orgPlans, type CliDescription, type OrgPlan, UsageError } from "@ea/core";
import { z } from "zod";

export const usage =
  "bun run org:plan --org-id <uuid> [--plan trial|active|suspended] [--trial-days N] [--max-mailboxes N]";

export const cliDescriptions = [
  {
    name: "org:plan",
    summary: "Sets the plan, the trial end or the mailbox limit of an organization.",
    risk: "write",
    needs: ["db"],
    usage,
  },
] satisfies readonly CliDescription[];

export interface OrgPlanArgs {
  orgId: string;
  plan?: OrgPlan;
  trialDays?: number;
  maxMailboxes?: number;
}

const digits = /^\d+$/;

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument; the range checks stay in `setOrgPlan`.
export function parseOrgPlanArgs(argv: string[]): OrgPlanArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-id": { type: "string" },
      plan: { type: "string" },
      "trial-days": { type: "string" },
      "max-mailboxes": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) throw new UsageError("--org-id is a uuid");
  const args: OrgPlanArgs = { orgId };

  if (values.plan !== undefined) {
    const plan = orgPlans.find((candidate) => candidate === values.plan);
    if (plan === undefined) throw new UsageError("--plan is trial, active or suspended");
    args.plan = plan;
  }
  if (values["trial-days"] !== undefined) {
    if (!digits.test(values["trial-days"])) throw new UsageError("--trial-days is a number");
    args.trialDays = Number(values["trial-days"]);
  }
  if (values["max-mailboxes"] !== undefined) {
    if (!digits.test(values["max-mailboxes"])) throw new UsageError("--max-mailboxes is a number");
    args.maxMailboxes = Number(values["max-mailboxes"]);
  }
  return args;
}
