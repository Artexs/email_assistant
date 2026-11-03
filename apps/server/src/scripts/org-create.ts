import { parseArgs } from "node:util";

import { createOrganizationWithOwner } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { createLog } from "../platform/log";

const log = createLog("org-create");

const usage =
  "usage: bun run org:create --org-name <name> --email <email> --display-name <name> [--timezone <tz, default Europe/Warsaw>]";

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-name": { type: "string" },
        email: { type: "string" },
        "display-name": { type: "string" },
        timezone: { type: "string", default: "Europe/Warsaw" },
      },
      strict: true,
    });
    const orgName = values["org-name"];
    const email = values.email;
    const displayName = values["display-name"];
    if (orgName === undefined || email === undefined || displayName === undefined) {
      return undefined;
    }
    return { orgName, email, displayName, timezone: values.timezone };
  } catch {
    return undefined;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const { orgId, userId } = await createOrganizationWithOwner(db, options);
    log.info(`created org ${orgId} user ${userId}`);
    return 0;
  } catch (error) {
    if (isUniqueViolation(error)) {
      log.error("user with this email already exists");
    } else {
      log.error("failed:", error instanceof Error ? error.message : error);
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
