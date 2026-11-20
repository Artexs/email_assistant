import { configureMailHosts, countDecryptableCredentials } from "../modules/mail";
import { runCli, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { cliDescriptions, parseCredentialsCheckArgs } from "./credentials-check-args";
import { credentialsLine } from "./lib/credentials-check-lines";

// Does the CREDENTIALS_KEY of this environment open every stored mailbox secret? `deploy/restore.sh` runs it before the server starts.
// The one result line `credentials ok=<n> failed=<m>` holds counts only: no secret, key, password, address, id or error text.
// A failed run prints the error name and code (`describeError`), never its message. Exit 0 when the rows were read (also when some
// do not open: the caller reads `failed`), exit 1 when the config or the database fails. A database that does not answer is also
// exit 1, not 3: `deploy/restore.sh` stops on any non-zero code and reads no other meaning from it.
const main: CliSpec["main"] = async (argv, out) => {
  parseCredentialsCheckArgs(argv);
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    out.print(credentialsLine(await countDecryptableCredentials(db, secrets)));
    return 0;
  } catch (error) {
    out.fail(`failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "credentials-check", descriptions: cliDescriptions, main });
}
