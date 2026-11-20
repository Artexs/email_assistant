import { format } from "node:util";

import { mailOAuthRuntime } from "../../composition";
import { configureMailHosts, MailAuthError, type OAuthTokens } from "../../modules/mail";
import { type CliRawOutput, createCliOutput } from "../../platform/cli";
import { loadConfig, mailAllowLocal } from "../../platform/config";
import { createSecretBox, type SecretBox } from "../../platform/crypto";
import { assertAppRole, createDb, type Db } from "../../platform/db";

// What an operator CLI on a stored mailbox needs from the outside. The production deps come from `runMailboxCli`; a test builds its own
// (the fake token registry, a capturing `out`). A CLI never reads a mailbox secret: the mail module opens the mailbox through
// `openMailboxProvider` with `oauthTokens`.
export interface CliDeps {
  db: Db;
  secrets: SecretBox;
  oauthTokens: OAuthTokens;
  /** `TEST_MAILBOX_ADDRESS`: one address or a comma-separated list. */
  testAddress: string | undefined;
  out: CliRawOutput;
}

/** Builds the production deps (the constant provider registry), runs `run` with the process arguments and closes the database. */
export async function runMailboxCli(
  name: string,
  run: (argv: string[], deps: CliDeps) => Promise<number>
): Promise<number> {
  const out = createCliOutput(name);
  try {
    const config = loadConfig();
    configureMailHosts({ allowLocal: mailAllowLocal(config) });
    const db = createDb(config.DATABASE_URL);
    try {
      await assertAppRole(db);
      const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
      return await run(process.argv.slice(2), {
        db,
        secrets,
        oauthTokens: mailOAuthRuntime(config, db, secrets).tokens,
        testAddress: config.TEST_MAILBOX_ADDRESS,
        out,
      });
    } finally {
      await db.destroy();
    }
  } catch (error) {
    // A config or setup fault. A config error names keys, never values.
    out.fail(`failed: ${error instanceof Error ? error.message : format(error)}`);
    return 1;
  }
}

/**
 * The failure line of a refused OAuth login: the reason code only (`oauth_expired`), never the error text. `null` for any other error.
 * A CLI never changes the mailbox status on it: only the jobs do.
 */
export function oauthReasonLine(error: unknown): string | null {
  return error instanceof MailAuthError && error.reason !== undefined ? `failed: ${error.reason}` : null;
}
