import { parseArgs } from "node:util";

import { z } from "zod";

import { unlinkUser } from "../modules/channels";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

const log = createLog("telegram-unlink");

const usage = "usage: bun run telegram:unlink --org-id <uuid> --user-id <uuid>";

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "user-id": { type: "string" },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const userId = values["user-id"];
    if (orgId === undefined || userId === undefined) return undefined;
    if (!z.uuid().safeParse(orgId).success || !z.uuid().safeParse(userId).success) return undefined;
    return { orgId, userId };
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

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const count = await unlinkUser(db, { orgId: options.orgId }, options.userId, new Date());
    log.info(`unlinked ${count} chat(s) of user ${options.userId}`);
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
