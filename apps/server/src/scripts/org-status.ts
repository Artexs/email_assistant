import { parseArgs } from "node:util";

import { z } from "zod";

import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { orgStatusLines } from "./org-status-lines";

const log = createLog("org-status");

const usage = "usage: bun run org:status [--org-id <uuid>]";

function readOptions(): { orgId?: string } | undefined {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { "org-id": { type: "string" } },
      strict: true,
    });
    const orgId = values["org-id"];
    if (orgId === undefined) return {};
    return z.uuid().safeParse(orgId).success ? { orgId } : undefined;
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
    const lines = await orgStatusLines(db, { ...options, now: new Date() });
    if (lines === null) {
      log.error("organization not found");
      return 1;
    }
    if (lines.length === 0) {
      log.info("no organizations");
      return 0;
    }
    process.stdout.write(`${lines.join("\n")}\n`);
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
