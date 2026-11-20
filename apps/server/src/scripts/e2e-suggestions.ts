import { Client } from "pg";

import { type CliSpec, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";

import { seedTargetOk } from "./e2e-seed-args";
import { cliDescriptions, parseE2eSuggestionsArgs } from "./e2e-suggestions-args";
import { seedSuggestionRows } from "./lib/e2e-suggestion-rows";

// The reset of the suggestions spec: the organization of the mailbox gets its three open suggestions again, no sender rule and fresh
// Sent coverage. Only an e2e database (the seed guard).
const main: CliSpec["main"] = async (argv, out) => {
  const { mailboxId } = parseE2eSuggestionsArgs(argv);
  const config = loadConfig();
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL ?? "";
  const target = seedTargetOk(config.DATABASE_URL, migratorUrl);
  if (!target.ok) {
    out.fail(`refusing: ${target.reason}`);
    return 1;
  }
  // The app role cannot read a mailbox without an organization, so the migrator finds it.
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  let orgId: string | undefined;
  try {
    const found = await client.query<{ org_id: string }>("SELECT org_id FROM mailboxes WHERE id = $1", [mailboxId]);
    orgId = found.rows[0]?.org_id;
  } finally {
    await client.end();
  }
  if (orgId === undefined) {
    out.fail("mailbox not found");
    return 1;
  }
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    await seedSuggestionRows(db, { orgId }, mailboxId, config.CREDENTIALS_KEY, new Date());
    out.print(`reset the suggestions of mailbox ${mailboxId}`);
    return 0;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "e2e-suggestions", descriptions: cliDescriptions, main });
}
