import { EXIT } from "@ea/core";

import { mailOAuthRuntime } from "../composition";
import { checkDraftCopy } from "../modules/actions";
import { configureMailHosts, openImapProvider, openMailboxProvider } from "../modules/mail";
import { exitCodeOf, runCli, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { describeError, errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { cliDescriptions, readCheckCopyOptions } from "./reply-check-copy-args";

const log = createLog("reply-check-copy");

// The probe of the copy hash (reply drafts): reads the Drafts copy of one draft and compares it with the stored hash.
// Parse first: a bad argument is a usage error (exit 2) before any config or DB.
const main: CliSpec["main"] = async (argv, out) => {
  const options = readCheckCopyOptions(argv);
  let db: Db | undefined;
  try {
    const config = loadConfig();
    configureMailHosts({ allowLocal: mailAllowLocal(config) });
    db = createDb(config.DATABASE_URL);
    const openDb = db;
    await assertAppRole(openDb);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const oauthTokens = mailOAuthRuntime(config, openDb, secrets).tokens;
    const result = await checkDraftCopy(
      {
        db: openDb,
        // The same opener as the committer: the credentials of the mailbox, and the token store for an OAuth mailbox.
        openProvider: async (ctx, mailboxId) =>
          (
            await openMailboxProvider(
              { db: openDb, secrets, openProvider: openImapProvider, oauthTokens },
              ctx,
              mailboxId
            )
          ).provider,
      },
      { orgId: options.orgId },
      options.actionId
    );
    if (result.kind === "not_found") {
      out.fail("no such draft in this organization");
      return 1;
    }
    out.print(result.result);
    return 0;
  } catch (error) {
    log.error("reply_check_copy_failed", { ...errorFields(error) });
    const code = exitCodeOf(error);
    if (code === EXIT.unreachable) out.fail(`unreachable: ${describeError(error)}`);
    return code;
  } finally {
    await db?.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "reply-check-copy", descriptions: cliDescriptions, main });
}
