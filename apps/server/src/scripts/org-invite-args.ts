import { parseArgs } from "node:util";

import { type CliDescription, type UserLocale, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "org:invite",
    summary: "Creates an organization with its owner and mails or prints the owner's setup link.",
    risk: "write",
    needs: ["db", "smtp"],
    usage:
      "bun run org:invite --org-name <name> --email <email> --display-name <name> [--lang pl|en, default pl] [--timezone <tz, default Europe/Warsaw>] [--trial-days N, default 30] [--print]",
    exits: { 1: "the web is off, the owner exists or the mail failed" },
    outputNote: "prints the setup link with `--print`",
  },
] satisfies readonly CliDescription[];

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

/** Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument. */
export function parseOrgInviteArgs(argv: string[]): OrgInviteOptions {
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
  if (orgName === undefined || email === undefined || displayName === undefined) {
    throw new UsageError("--org-name, --email and --display-name are needed");
  }
  const locale = values.lang;
  if (locale !== "pl" && locale !== "en") throw new UsageError("--lang is pl or en");
  const trialDaysText = values["trial-days"];
  if (trialDaysText !== undefined && !/^\d+$/.test(trialDaysText)) {
    throw new UsageError("--trial-days is a number");
  }
  const trialDays = trialDaysText === undefined ? DEFAULT_TRIAL_DAYS : Number(trialDaysText);
  if (trialDays < 1 || trialDays > 365) throw new UsageError("--trial-days is 1 to 365");
  return {
    orgName,
    email,
    displayName,
    locale,
    timezone: values.timezone,
    trialDays,
    print: values.print,
  };
}
