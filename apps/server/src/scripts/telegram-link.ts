import { EXIT } from "@ea/core";

import { checkBot, createLinkToken, telegramErrorLabel } from "../modules/channels";
import { exitCodeOf, runCli, type CliSpec } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError, HardError } from "../platform/errors";

import { pickMemberId } from "./lib/pick-member";
import { cliDescriptions, parseTelegramLinkArgs } from "./telegram-link-args";

function describeFailure(error: unknown, code: number): string {
  if (error instanceof HardError) return error.message;
  // A Telegram error is never printed with its message: it can hold the token (`telegramErrorLabel`).
  return code === EXIT.unreachable ? `unreachable: ${describeError(error)}` : `failed: ${telegramErrorLabel(error)}`;
}

const main: CliSpec["main"] = async (argv, out) => {
  // Parse first: a bad argument exits 2 before the config or the DB.
  const options = parseTelegramLinkArgs(argv);

  const config = loadConfig();
  const token = config.TELEGRAM_BOT_TOKEN;
  if (token === undefined) {
    out.fail("TELEGRAM_BOT_TOKEN is not set");
    return 1;
  }

  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const userId = await pickMemberId(db, options.orgId, options.userId, out);
    if (userId === undefined) return 1;

    // The bot check comes first: a bad token must not leave a token row.
    const { username } = await checkBot(token, { apiRoot: config.TELEGRAM_API_ROOT });
    const link = await createLinkToken(db, { orgId: options.orgId }, userId, new Date());
    const until = link.expiresAt.toISOString().slice(11, 16);
    out.write(
      [
        `Open this link on the user's phone within 15 minutes (until ${until} UTC):`,
        `https://t.me/${username}?start=${link.token}`,
        "The link works once. Do not share it.",
        "",
      ].join("\n")
    );
    out.print(`link token made for user ${userId}, valid until ${link.expiresAt.toISOString()}`);
    return 0;
  } catch (error) {
    const code = exitCodeOf(error);
    out.fail(describeFailure(error, code));
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) await runCli({ prefix: "telegram-link", descriptions: cliDescriptions, main });
