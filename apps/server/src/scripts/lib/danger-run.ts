import { EXIT, orgNameMatches } from "@ea/core";

import { getOrganization } from "../../modules/tenancy";
import type { CliOutput } from "../../platform/cli";
import { exitCodeOf } from "../../platform/cli";
import { loadConfig } from "../../platform/config";
import { assertAppRole, createDb, type Db } from "../../platform/db";
import { describeError } from "../../platform/errors";

type Config = ReturnType<typeof loadConfig>;

/**
 * The shared frame of a danger tool (docs/cli.md § Risk classes) after its arguments parsed: loads the config, opens the
 * DB with the app role check, runs `run`, closes the DB. An error is one event line (`onError`) and an exit code from
 * `exitCodeOf` (an unreachable DB prints `unreachable: …`, exit 3). `onError` writes the tool's own event line.
 */
export async function withDangerDb(
  onError: (error: unknown) => void,
  out: CliOutput,
  run: (db: Db, config: Config) => Promise<number>
): Promise<number> {
  let db: Db | undefined;
  try {
    const config = loadConfig();
    db = createDb(config.DATABASE_URL);
    await assertAppRole(db);
    return await run(db, config);
  } catch (error) {
    onError(error);
    const code = exitCodeOf(error);
    if (code === EXIT.unreachable) out.fail(`unreachable: ${describeError(error)}`);
    return code;
  } finally {
    await db?.destroy();
  }
}

/**
 * The confirm guard of a data-changing danger run (docs/cli.md): the organization name that the operator typed must match
 * the stored name, by the rule of the web delete (`orgNameMatches`). Reads the row through the tenancy index; changes
 * nothing. Returns the exit code of a refusal (1), or null when the run may go on.
 */
export async function refuseUnlessConfirmed(
  db: Db,
  orgId: string,
  confirm: string,
  out: CliOutput
): Promise<number | null> {
  const organization = await getOrganization(db, { orgId });
  if (!organization) {
    out.fail("organization not found");
    return EXIT.failed;
  }
  if (!orgNameMatches(organization.name, confirm)) {
    out.fail("refused: confirm does not match");
    return EXIT.failed;
  }
  return null;
}
