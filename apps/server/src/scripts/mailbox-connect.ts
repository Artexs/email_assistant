import { EXIT } from "@ea/core";
import { z } from "zod";

import {
  configureMailHosts,
  connectMailbox,
  MailboxExistsError,
  MailboxLimitError,
  openImapProvider,
  verifySmtpLogin,
  type MailCapabilities,
} from "../modules/mail";
import { queueHistoryCheckOnConnect } from "../modules/trust";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { loadConfig, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";

import { reportFailure } from "./lib/mailbox-failure";
import { readStdinSecret } from "./lib/stdin-secret";
import { cliDescriptions, parseMailboxConnectArgs, type MailboxConnectArgs } from "./mailbox-connect-args";

const CAPABILITY_LABELS: [keyof MailCapabilities, string][] = [
  ["idle", "IDLE"],
  ["move", "MOVE"],
  ["uidplus", "UIDPLUS"],
  ["condstore", "CONDSTORE"],
  ["specialUse", "SPECIAL-USE"],
  ["keywords", "KEYWORDS"],
];

async function run(options: MailboxConnectArgs, password: string, out: CliRawOutput): Promise<number> {
  const config = loadConfig();

  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
    const { orgId, ...input } = options;
    const { mailboxId, info, sentSync } = await connectMailbox(
      {
        db,
        secrets,
        openProvider: openImapProvider,
        verifySmtp: verifySmtpLogin,
        onConnected: queueHistoryCheckOnConnect(db),
      },
      { orgId },
      { ...input, password }
    );
    out.print(`connected mailbox ${mailboxId}`);
    if (sentSync) {
      out.print(
        `sent mail: tracked, read only (turn off: bun run mailbox:settings sent-sync --org-id ${orgId} --mailbox-id ${mailboxId} --value off)`
      );
    }
    for (const [key, label] of CAPABILITY_LABELS) {
      out.print(`${label}=${info.capabilities[key] ? "yes" : "no"}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof MailboxExistsError) {
      out.fail("mailbox with this address already exists");
    } else if (error instanceof MailboxLimitError) {
      out.fail(`mailbox limit reached (max ${error.max})`);
    } else if (error instanceof z.ZodError) {
      // A bad value that the service refused before any login: usage (exit 2).
      out.fail(`invalid input: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
      out.fail(`usage: ${cliDescriptions.map((description) => description.usage).join("\n")}`);
      return EXIT.usage;
    } else {
      return reportFailure(out, error, "message");
    }
    return 1;
  } finally {
    await db.destroy();
  }
}

// Parse first: a bad argument is a usage error (exit 2) before stdin, config or DB. The password comes only from a pipe.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxConnectArgs(argv);
  const secret = await readStdinSecret();
  if (!secret.ok) {
    out.fail(secret.refusal);
    return 1;
  }
  try {
    return await run(options, secret.secret, out);
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-connect", descriptions: cliDescriptions, main });
}
