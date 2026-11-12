import { parseArgs } from "node:util";

import type { UserLocale } from "@ea/core";

export const orgInviteUsage =
  "usage: bun run org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en, default pl] [--timezone <tz, default Europe/Warsaw>] [--trial-days N, default 30] [--print]";

export interface OrgInviteOptions {
  orgName: string;
  email: string;
  displayName: string;
  locale: UserLocale;
  timezone: string;
  trialDays: number;
  print: boolean;
}

const DEFAULT_TRIAL_DAYS = 30;

/** undefined = print the usage and exit 1. */
export function parseOrgInviteArgs(argv: string[]): OrgInviteOptions | undefined {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        "org-name": { type: "string" },
        email: { type: "string" },
        "display-name": { type: "string" },
        lang: { type: "string", default: "pl" },
        timezone: { type: "string", default: "Europe/Warsaw" },
        "trial-days": { type: "string" },
        print: { type: "boolean", default: false },
      },
      strict: true,
    });
    const orgName = values["org-name"];
    const email = values.email;
    const displayName = values["display-name"];
    if (orgName === undefined || email === undefined || displayName === undefined) return undefined;
    const locale = values.lang;
    if (locale !== "pl" && locale !== "en") return undefined;
    const trialDaysText = values["trial-days"];
    if (trialDaysText !== undefined && !/^\d+$/.test(trialDaysText)) return undefined;
    const trialDays = trialDaysText === undefined ? DEFAULT_TRIAL_DAYS : Number(trialDaysText);
    if (trialDays < 1 || trialDays > 365) return undefined;
    return {
      orgName,
      email,
      displayName,
      locale,
      timezone: values.timezone,
      trialDays,
      print: values.print,
    };
  } catch {
    return undefined;
  }
}
