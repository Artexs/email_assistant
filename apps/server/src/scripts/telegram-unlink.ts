import { EXIT } from "@ea/core";

import { unlinkUser } from "../modules/channels";
import { exitCodeOf, runCli, type CliSpec } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { cliDescriptions, parseTelegramUnlinkArgs } from "./telegram-unlink-args";

const main: CliSpec["main"] = async (argv, out) => {
  // Parse first: a bad argument exits 2 before the config or the DB.
  const options = parseTelegramUnlinkArgs(argv);

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const count = await unlinkUser(db, { orgId: options.orgId }, options.userId, new Date());
    out.print(`unlinked ${count} chat(s) of user ${options.userId}`);
    return 0;
  } catch (error) {
    const code = exitCodeOf(error);
    out.fail(`${code === EXIT.unreachable ? "unreachable" : "failed"}: ${describeError(error)}`);
    return code;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) await runCli({ prefix: "telegram-unlink", descriptions: cliDescriptions, main });
