import { parseArgs } from "node:util";

import { z } from "zod";

import { checkBot, createLinkToken, telegramErrorLabel } from "../modules/channels";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { HardError } from "../platform/errors";
import { createLog } from "../platform/log";

import { pickMemberId } from "./pick-member";

const log = createLog("telegram-link");

const usage = "usage: bun run telegram:link --org-id <uuid> [--user-id <uuid>]";

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
    if (orgId === undefined || !z.uuid().safeParse(orgId).success) return undefined;
    if (userId !== undefined && !z.uuid().safeParse(userId).success) return undefined;
    return { orgId, userId };
  } catch {
    return undefined;
  }
}

function describeFailure(error: unknown): string {
  if (error instanceof HardError) return error.message;
  return `failed: ${telegramErrorLabel(error)}`;
}

async function main(): Promise<number> {
  const options = readOptions();
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();
  const token = config.TELEGRAM_BOT_TOKEN;
  if (token === undefined) {
    log.error("TELEGRAM_BOT_TOKEN is not set");
    return 1;
  }

  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const userId = await pickMemberId(db, options.orgId, options.userId, log);
    if (userId === undefined) return 1;

    // The bot check comes first: a bad token must not leave a token row.
    const { username } = await checkBot(token, { apiRoot: config.TELEGRAM_API_ROOT });
    const link = await createLinkToken(db, { orgId: options.orgId }, userId, new Date());
    const until = link.expiresAt.toISOString().slice(11, 16);
    process.stdout.write(
      [
        `Open this link on the user's phone within 15 minutes (until ${until} UTC):`,
        `https://t.me/${username}?start=${link.token}`,
        "The link works once. Do not share it.",
        "",
      ].join("\n")
    );
    log.info(`link token made for user ${userId}, valid until ${link.expiresAt.toISOString()}`);
    return 0;
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
