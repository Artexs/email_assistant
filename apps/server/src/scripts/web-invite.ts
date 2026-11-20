import { getMembership, getUserAuthProfile } from "../modules/tenancy";
import { type CliSpec, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { HardError } from "../platform/errors";

import { deliverInvite } from "./lib/invite-delivery";
import { pickMemberId } from "./lib/pick-member";
import { cliDescriptions, parseWebInviteArgs } from "./web-invite-args";

const main: CliSpec["main"] = async (argv, out) => {
  const options = parseWebInviteArgs(argv);

  const config = loadConfig();
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    out.fail("WEB_BASE_URL is empty: the web is off; set WEB_BASE_URL and WEB_AUTH_SECRET first");
    return 1;
  }

  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const userId = await pickMemberId(db, options.orgId, options.userId, out);
    if (userId === undefined) return 1;
    const membership = await getMembership(db, { orgId: options.orgId }, userId);
    if (!membership) {
      out.fail("user is not a member of this organization");
      return 1;
    }

    const profile = await getUserAuthProfile(db, userId);
    return await deliverInvite({
      config,
      db,
      orgId: options.orgId,
      userId,
      email: membership.email,
      locale: profile?.locale ?? "pl",
      print: options.print,
      out,
    });
  } catch (error) {
    // Any other error goes to `runCli`: `failed:` (exit 1) or `unreachable:` (exit 3).
    if (!(error instanceof HardError)) throw error;
    out.fail(error.message);
    return 1;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "web-invite", descriptions: cliDescriptions, main });
}
