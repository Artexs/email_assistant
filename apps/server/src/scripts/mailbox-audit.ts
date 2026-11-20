import { auditExitCode, auditMailbox } from "../modules/mail";
import { runCli, type CliSpec } from "../platform/cli";

import { type CliDeps, oauthReasonLine, withMailboxDeps } from "./lib/mailbox-cli";
import { reportFailure } from "./lib/mailbox-failure";
import { cliDescriptions, type MailboxAuditArgs, parseMailboxAuditArgs } from "./mailbox-audit-args";

// Returns the exit code. `main` builds the production deps; a test calls `run` with its own.
export async function run(options: MailboxAuditArgs, deps: CliDeps): Promise<number> {
  const { out } = deps;
  try {
    const results = await auditMailbox(deps, { orgId: options.orgId }, options.mailboxId, options.since);
    for (const { key, counts } of results) {
      if (counts === null) {
        out.print(`folder=${key} not on the server`);
      } else if (key === "inbox") {
        out.print(
          `inbox=${counts.mail} stored=${counts.stored} missing=${counts.missing} duplicates=${counts.duplicates} cross=${counts.cross}`
        );
      } else {
        out.print(
          `folder=${key} mail=${counts.mail} stored=${counts.stored} missing=${counts.missing} duplicates=${counts.duplicates} cross=${counts.cross}`
        );
      }
    }
    return auditExitCode(results.find((result) => result.key === "inbox")?.counts);
  } catch (error) {
    const reason = oauthReasonLine(error);
    if (reason !== null) {
      out.fail(reason);
      return 1;
    }
    return reportFailure(out, error, "message");
  }
}

// Parse first: a bad argument is a usage error (exit 2) before any config or DB. Any later error gets one line and its code.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseMailboxAuditArgs(argv);
  try {
    return await withMailboxDeps(out, (deps) => run(options, deps));
  } catch (error) {
    return reportFailure(out, error, "message");
  }
};

if (import.meta.main) {
  await runCli({ prefix: "mailbox-audit", descriptions: cliDescriptions, main });
}
