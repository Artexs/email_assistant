import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "org:create",
    summary: "Creates an organization with its owner on a trial or an active plan.",
    risk: "write",
    needs: ["db"],
    usage:
      "bun run org:create --org-name <name> --email <email> --display-name <name> [--timezone <tz, default Europe/Warsaw>] [--plan trial|active, default trial] [--trial-days N, default 30, trial only]",
  },
] satisfies readonly CliDescription[];

export interface OrgCreateArgs {
  orgName: string;
  email: string;
  displayName: string;
  timezone: string;
  plan: { kind: "active" } | { kind: "trial"; trialDays: number };
}

const DEFAULT_TRIAL_DAYS = 30;
const MAX_TRIAL_DAYS = 365;

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument. The trial end date is the caller's: no clock here.
export function parseOrgCreateArgs(argv: string[]): OrgCreateArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      "org-name": { type: "string" },
      email: { type: "string" },
      "display-name": { type: "string" },
      timezone: { type: "string", default: "Europe/Warsaw" },
      plan: { type: "string", default: "trial" },
      "trial-days": { type: "string" },
    },
    strict: true,
  });
  const orgName = values["org-name"];
  const email = values.email;
  const displayName = values["display-name"];
  if (orgName === undefined || email === undefined || displayName === undefined) {
    throw new UsageError("--org-name, --email and --display-name are needed");
  }
  const base = { orgName, email, displayName, timezone: values.timezone };
  const trialDaysText = values["trial-days"];
  if (values.plan === "active") {
    if (trialDaysText !== undefined) throw new UsageError("--trial-days is for a trial plan only");
    return { ...base, plan: { kind: "active" } };
  }
  if (values.plan !== "trial") throw new UsageError("--plan is trial or active");
  if (trialDaysText !== undefined && !/^\d+$/.test(trialDaysText)) throw new UsageError("--trial-days is a number");
  const trialDays = trialDaysText === undefined ? DEFAULT_TRIAL_DAYS : Number(trialDaysText);
  if (trialDays < 1 || trialDays > MAX_TRIAL_DAYS) throw new UsageError(`--trial-days is 1 to ${MAX_TRIAL_DAYS}`);
  return { ...base, plan: { kind: "trial", trialDays } };
}
