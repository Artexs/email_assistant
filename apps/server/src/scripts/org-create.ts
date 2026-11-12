import { parseArgs } from "node:util";

import { createOrganizationWithOwner } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("org-create");

const usage =
  "usage: bun run org:create --org-name <name> --email <email> --display-name <name> [--timezone <tz, default Europe/Warsaw>] [--plan trial|active, default trial] [--trial-days N, default 30, trial only]";

const dayMs = 24 * 60 * 60 * 1000;
const defaultTrialDays = 30;

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
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
      return undefined;
    }
    const trialDaysText = values["trial-days"];
    if (values.plan === "active") {
      if (trialDaysText !== undefined) return undefined;
      return { orgName, email, displayName, timezone: values.timezone, plan: { kind: "active" } as const };
    }
    if (values.plan !== "trial") return undefined;
    if (trialDaysText !== undefined && !/^\d+$/.test(trialDaysText)) return undefined;
    const trialDays = trialDaysText === undefined ? defaultTrialDays : Number(trialDaysText);
    if (trialDays < 1 || trialDays > 365) return undefined;
    const endsAt = new Date(Date.now() + trialDays * dayMs);
    return { orgName, email, displayName, timezone: values.timezone, plan: { kind: "trial", endsAt } as const };
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
    const trialEndsAt = options.plan.kind === "trial" ? options.plan.endsAt.toISOString() : "-";
    log.info(`created org ${orgId} user ${userId} plan ${options.plan.kind} trial_ends_at ${trialEndsAt}`);
    return 0;
  } catch (error) {
    if (isUniqueViolation(error)) {
      log.error("user with this email already exists");
    } else {
      log.error(`failed: ${describeError(error)}`);
    }
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
