import { parseArgs } from "node:util";

import { z } from "zod";

import { getMembership, getUserAuthProfile } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError, HardError } from "../platform/errors";
import { createLog } from "../platform/log";

import { deliverInvite } from "./invite-delivery";
import { pickMemberId } from "./pick-member";

const log = createLog("web-invite");

const usage = "usage: bun run web:invite --org-id <uuid> [--user-id <uuid>] [--print]";

function readOptions() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "org-id": { type: "string" },
        "user-id": { type: "string" },
        print: { type: "boolean", default: false },
      },
      strict: true,
    });
    const orgId = values["org-id"];
    const userId = values["user-id"];
    if (orgId === undefined || !z.uuid().safeParse(orgId).success) return undefined;
    if (userId !== undefined && !z.uuid().safeParse(userId).success) return undefined;
    return { orgId, userId, print: values.print };
  } catch {
    return undefined;
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof HardError) return error.message;
  return `failed: ${describeError(error)}`;
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    log.error("WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first");
    return 1;
  }

  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const userId = await pickMemberId(db, options.orgId, options.userId, log);
    if (userId === undefined) return 1;
    const membership = await getMembership(db, { orgId: options.orgId }, userId);
    if (!membership) {
      log.error("user is not a member of this organization");
      return 1;
    }

    const profile = await getUserAuthProfile(db, userId);
    return await deliverInvite({
      config,
      db,
      orgId: options.orgId,
      userId,
      email: membership.email,
      locale: profile?.locale ?? "pl",
      print: options.print,
      log,
    });
  } catch (error) {
    log.error(describeFailure(error));
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error(describeFailure(error));
    process.exit(1);
  });
