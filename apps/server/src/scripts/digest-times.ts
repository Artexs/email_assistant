import { getOrganization, setDigestTimes } from "../modules/tenancy";
import { runCli, type CliSpec } from "../platform/cli";

import { cliDescriptions, parseDigestTimesArgs } from "./digest-times-args";
import { pickMemberId } from "./lib/pick-member";
import { withDb } from "./lib/with-db";

// Parse first: a bad argument is a usage error (exit 2) before any config or DB.
const main: CliSpec["main"] = async (argv, out) => {
  const options = parseDigestTimesArgs(argv);
  return withDb(out, async (db) => {
    const ctx = { orgId: options.orgId };
    const userId = await pickMemberId(db, options.orgId, options.userId, out);
    if (userId === undefined) return 1;
    if (!(await setDigestTimes(db, ctx, userId, options.times))) {
      out.fail("no membership for this user in this organization");
      return 1;
    }
    const organization = await getOrganization(db, ctx);
    out.print(
      `digest times of user ${userId}: ${options.times.join(", ") || "none"} (${organization?.timezone ?? "unknown timezone"})`
    );
    return 0;
  });
};

if (import.meta.main) {
  await runCli({ prefix: "digest-times", descriptions: cliDescriptions, main });
}
