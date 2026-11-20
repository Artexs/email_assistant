import { queueHistoryCheckByOperator } from "../modules/trust";
import { runCli, type CliSpec } from "../platform/cli";

import { withDb } from "./lib/with-db";
import { cliDescriptions, parseTrustHistoryCheckArgs } from "./trust-history-check-args";

// Parse first: a bad argument is a usage error (exit 2) before any config or DB.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseTrustHistoryCheckArgs(argv);
  return withDb(out, async (db) => {
    const result = await queueHistoryCheckByOperator(db, { orgId: options.orgId }, options.mailboxId);
    if (result.kind === "org_suspended") {
      out.fail(`organization ${options.orgId} is suspended: org_suspended. Resume it with org:plan first.`);
      return 1;
    }
    if (result.kind === "mailbox_not_found") {
      out.fail(`mailbox ${options.mailboxId} not found in organization ${options.orgId}`);
      return 1;
    }
    out.print(
      `${result.kind === "queued" ? "queued" : "already open"}: check ${result.checkId}, status ${result.status}`
    );
    return 0;
  });
};

if (import.meta.main) {
  await runCli({ prefix: "trust-history-check", descriptions: cliDescriptions, main });
}
