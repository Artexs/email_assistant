import { DAY_MS } from "@ea/core";

import { createOrganizationWithOwner } from "../modules/tenancy";
import { type CliSpec, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { deliverInvite } from "./lib/invite-delivery";
import { cliDescriptions, parseOrgInviteArgs } from "./org-invite-args";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

const main: CliSpec["main"] = async (argv, out) => {
  const options = parseOrgInviteArgs(argv);

  const config = loadConfig();
  if (config.WEB_BASE_URL === undefined || config.WEB_AUTH_SECRET === undefined) {
    out.fail("WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first");
    return 1;
  }

  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const endsAt = new Date(Date.now() + options.trialDays * DAY_MS);
    let created: { orgId: string; userId: string };
    try {
      created = await createOrganizationWithOwner(db, {
        orgName: options.orgName,
        email: options.email,
        displayName: options.displayName,
        timezone: options.timezone,
        locale: options.locale,
        plan: { kind: "trial", endsAt },
      });
    } catch (error) {
      // The transaction rolled back: no organization exists.
      if (!isUniqueViolation(error)) throw error;
      out.fail("user with this email already exists");
      return 1;
    }
    const { orgId, userId } = created;
    out.print(`created org ${orgId} user ${userId} plan trial trial_ends_at ${endsAt.toISOString()}`);
    return await deliverInvite({
      config,
      db,
      orgId,
      userId,
      email: options.email.toLowerCase(),
      locale: options.locale,
      print: options.print,
      out,
    });
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "org-invite", descriptions: cliDescriptions, main });
}
