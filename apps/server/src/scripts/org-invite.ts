import { createOrganizationWithOwner } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { deliverInvite } from "./invite-delivery";
import { orgInviteUsage, parseOrgInviteArgs } from "./org-invite-args";

const log = createLog("org-invite");

const DAY_MS = 24 * 60 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function main(): Promise<number> {
  const options = parseOrgInviteArgs(process.argv.slice(2));
  if (!options) {
    log.error(orgInviteUsage);
    return 1;
  }

  const config = loadConfig();
  if (config.WEB_BASE_URL === undefined || config.WEB_AUTH_SECRET === undefined) {
    log.error("WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first");
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
      log.error(isUniqueViolation(error) ? "user with this email already exists" : `failed: ${describeError(error)}`);
      return 1;
    }
    const { orgId, userId } = created;
    log.info(`created org ${orgId} user ${userId} plan trial trial_ends_at ${endsAt.toISOString()}`);
    return await deliverInvite({
      config,
      db,
      orgId,
      userId,
      email: options.email.toLowerCase(),
      locale: options.locale,
      print: options.print,
      log,
    });
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
