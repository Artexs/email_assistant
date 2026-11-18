import { mailOAuthRuntime } from "../composition";
import { checkDraftCopy } from "../modules/actions";
import { configureMailHosts, openImapProvider, openMailboxProvider } from "../modules/mail";
import { createCliOutput } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { readCheckCopyOptions, usage } from "./reply-check-copy-args";

const out = createCliOutput("reply-check-copy");
const log = createLog("reply-check-copy");

// The probe of the copy hash (reply drafts): reads the Drafts copy of one draft and compares it with the stored hash.
async function main(): Promise<number> {
  const options = readCheckCopyOptions(process.argv.slice(2));
  if (!options) {
    out.fail(usage);
    return 1;
  }
  const config = loadConfig();
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const oauthTokens = mailOAuthRuntime(config, db, secrets).tokens;
    const result = await checkDraftCopy(
      {
        db,
        // The same opener as the committer: the credentials of the mailbox, and the token store for an OAuth mailbox.
        openProvider: async (ctx, mailboxId) =>
          (await openMailboxProvider({ db, secrets, openProvider: openImapProvider, oauthTokens }, ctx, mailboxId))
            .provider,
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
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("reply_check_copy_failed", { ...errorFields(error) });
    process.exit(1);
  });
