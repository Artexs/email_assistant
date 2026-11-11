import { Client } from "pg";

import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import { seedActivityRows } from "./e2e-activity-rows";
import { seedTargetOk } from "./e2e-seed-args";

const log = createLog("e2e-activity");

function mailboxIdArg(argv: string[]): string | null {
  const index = argv.indexOf("--mailbox-id");
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value === "" ? null : value;
}

async function main(): Promise<number> {
  const mailboxId = mailboxIdArg(process.argv.slice(2));
  if (mailboxId === null) {
    process.stderr.write("usage: bun apps/server/src/scripts/e2e-activity.ts --mailbox-id <uuid>\n");
    return 2;
  }
  const config = loadConfig();
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL ?? "";
  const target = seedTargetOk(config.DATABASE_URL, migratorUrl);
  if (!target.ok) {
    log.error(`refusing: ${target.reason}`);
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
    log.error("mailbox not found");
    return 1;
  }

  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await seedActivityRows(db, { orgId }, mailboxId, new Date());
    log.info(`seeded ${result.total} activity rows for mailbox ${mailboxId}`);
    return 0;
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
