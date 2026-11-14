import { configureMailHosts, signalsOfMailbox } from "../modules/mail";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { readSignalsOptions, signalsLines, usage } from "./mailbox-signals-args";

const log = createLog("mailbox-signals");

async function main(): Promise<number> {
  const options = readSignalsOptions(process.argv.slice(2));
  if (!options) {
    log.error(usage);
    return 1;
  }

  const config = loadConfig();

  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const since = new Date(Date.now() - options.days * 24 * 3_600_000);
    const signals = await signalsOfMailbox({ db, secrets }, { orgId: options.orgId }, options.mailboxId, since);
    // The figures are for the operator, not log lines.
    process.stdout.write(`${signalsLines(signals).join("\n")}\n`);
    return 0;
  } catch (error) {
    log.error("mailbox_signals_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("mailbox_signals_failed", { ...errorFields(error) });
    process.exit(1);
  });
