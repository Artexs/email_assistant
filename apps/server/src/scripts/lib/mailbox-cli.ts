import { mailOAuthRuntime } from "../../composition";
import { configureMailHosts, MailAuthError, type OAuthTokens } from "../../modules/mail";
import type { CliRawOutput } from "../../platform/cli";
import { loadConfig, mailAllowLocal } from "../../platform/config";
import { createSecretBox, type SecretBox } from "../../platform/crypto";
import { assertAppRole, createDb, type Db } from "../../platform/db";

// What an operator CLI on a stored mailbox needs from the outside. The production deps come from `withMailboxDeps`; a test builds its own
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

/**
 * Builds the production deps (the constant provider registry), runs `run` with them and closes the database. An entry calls it
 * inside `main`, after its parse: nothing here runs at module load, so `--help` and a bad flag need no env. A config or setup fault
 * throws to the entry's outer catch (`reportFailure`).
 */
export async function withMailboxDeps(out: CliRawOutput, run: (deps: CliDeps) => Promise<number>): Promise<number> {
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    return await run({
      db,
      secrets,
      oauthTokens: mailOAuthRuntime(config, db, secrets).tokens,
      testAddress: config.TEST_MAILBOX_ADDRESS,
      out,
    });
  } finally {
    await db.destroy();
  }
}

/**
 * The failure line of a refused OAuth login: the reason code only (`oauth_expired`), never the error text. `null` for any other error.
 * A CLI never changes the mailbox status on it: only the jobs do.
 */
export function oauthReasonLine(error: unknown): string | null {
  return error instanceof MailAuthError && error.reason !== undefined ? `failed: ${error.reason}` : null;
}
