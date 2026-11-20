import { deleteOrganization } from "../modules/privacy";
import { runCli, type CliSpec } from "../platform/cli";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { withDangerDb } from "./lib/danger-run";
import { cliDescriptions, parseOrgDeleteArgs } from "./org-delete-args";

const log = createLog("org-delete");
const failed = (error: unknown): void => log.error("org_delete_failed", { ...errorFields(error) });

// Prints ids and counts. The one exception: after a delete it prints the mailbox addresses, so that the
// operator tells the owner which passwords to change. Never the organization name. The service compares the
// typed name with `orgNameMatches` inside its transaction: that is the confirm guard.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOrgDeleteArgs(argv);
  return withDangerDb(failed, out, async (db) => {
    const result = await deleteOrganization(db, { ...args, via: "cli" });
    if (result.kind === "busy") {
      out.writeErr("busy, try again\n");
      log.error("org_delete_refused", { reason: "busy" });
      return 1;
    }
    if (result.kind !== "deleted") {
      log.error("org_delete_refused", { reason: result.kind });
      return 1;
    }
    out.write(`deleted ${args.orgId}: mailboxes ${result.mailboxAddresses.length}\n`);
    for (const address of result.mailboxAddresses) {
      out.write(`change the password of ${address}\n`);
    }
    return 0;
  });
};

if (import.meta.main) {
  await runCli({ prefix: "org-delete", descriptions: cliDescriptions, main });
}
