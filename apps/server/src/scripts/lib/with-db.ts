import type { CliOutput } from "../../platform/cli";
import { loadConfig } from "../../platform/config";
import { assertAppRole, createDb, type Db } from "../../platform/db";

import { reportFailure } from "./mailbox-failure";

/**
 * The frame of a tool that needs the DB, after its arguments parsed: loads the config, opens the DB with the app role check,
 * runs `run`, closes the DB. An error is one line and an exit code (`unreachable: …` and 3 when the DB did not answer,
 * `failed: <error name and code>` and 1 otherwise), as `reportFailure` prints it.
 */
export async function withDb(out: CliOutput, run: (db: Db) => Promise<number>): Promise<number> {
  try {
    const db = createDb(loadConfig().DATABASE_URL);
    try {
      await assertAppRole(db);
      return await run(db);
    } finally {
      await db.destroy();
    }
  } catch (error) {
    return reportFailure(out, error, "label");
  }
}
