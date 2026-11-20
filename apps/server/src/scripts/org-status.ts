import { type CliSpec, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { orgStatusLines } from "./lib/org-status-lines";
import { cliDescriptions, parseOrgStatusArgs } from "./org-status-args";

// An error is not caught here: `runCli` prints `failed:` (exit 1) or `unreachable:` (exit 3, the database did not answer).
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseOrgStatusArgs(argv);

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const lines = await orgStatusLines(db, { ...options, now: new Date() });
    if (lines === null) {
      out.fail("organization not found");
      return 1;
    }
    if (lines.length === 0) {
      out.print("no organizations");
      return 0;
    }
    out.write(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "org-status", descriptions: cliDescriptions, main });
}
