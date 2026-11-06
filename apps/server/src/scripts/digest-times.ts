import { parseArgs } from "node:util";

import { parseDigestTimesInput } from "@ea/core";
import { z } from "zod";

import { getOrganization, setDigestTimes } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { pickMemberId } from "./pick-member";

const log = createLog("digest-times");

const usage = "usage: bun run digest:times --org-id <uuid> [--user-id <uuid>] --times <HH:MM,HH:MM | none>";

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "user-id": { type: "string" },
        times: { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const userId = values["user-id"];
    if (orgId === undefined || values.times === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success) return undefined;
    if (userId !== undefined && !z.uuid().safeParse(userId).success) return undefined;
    return { orgId, userId, input: values.times };
  } catch {
    return undefined;
  }
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }
  const parsed = parseDigestTimesInput(options.input);
  if (!parsed.ok) {
    log.error(parsed.error);
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: options.orgId };
    const userId = await pickMemberId(db, options.orgId, options.userId, log);
    if (userId === undefined) return 1;
    if (!(await setDigestTimes(db, ctx, userId, parsed.times))) {
      log.error("no membership for this user in this organization");
      return 1;
    }
    const organization = await getOrganization(db, ctx);
    log.info(
      `digest times of user ${userId}: ${parsed.times.join(", ") || "none"} (${organization?.timezone ?? "unknown timezone"})`
    );
    return 0;
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
