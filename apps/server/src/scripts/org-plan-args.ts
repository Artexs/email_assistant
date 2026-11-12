import { parseArgs } from "node:util";

import { orgPlans, type OrgPlan } from "@ea/core";
import { z } from "zod";

export const usage =
  "usage: bun run org:plan --org-id <uuid> [--plan trial|active|suspended] [--trial-days N] [--max-mailboxes N]";

export interface OrgPlanArgs {
  orgId: string;
  plan?: OrgPlan;
  trialDays?: number;
  maxMailboxes?: number;
}

const digits = /^\d+$/;

// null on any bad argument; the range checks stay in `setOrgPlan`.
export function parseOrgPlanArgs(argv: string[]): OrgPlanArgs | null {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "org-id": { type: "string" },
        plan: { type: "string" },
        "trial-days": { type: "string" },
        "max-mailboxes": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return null;
  }

  const orgId = values["org-id"];
  if (orgId === undefined || !z.uuid().safeParse(orgId).success) return null;
  const args: OrgPlanArgs = { orgId };

  if (values.plan !== undefined) {
    const plan = orgPlans.find((candidate) => candidate === values.plan);
    if (plan === undefined) return null;
    args.plan = plan;
  }
  if (values["trial-days"] !== undefined) {
    if (!digits.test(values["trial-days"])) return null;
    args.trialDays = Number(values["trial-days"]);
  }
  if (values["max-mailboxes"] !== undefined) {
    if (!digits.test(values["max-mailboxes"])) return null;
    args.maxMailboxes = Number(values["max-mailboxes"]);
  }
  return args;
}
