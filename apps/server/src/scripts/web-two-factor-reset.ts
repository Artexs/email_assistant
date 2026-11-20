import { resetTwoFactor } from "../modules/tenancy";
import { runCli, type CliSpec } from "../platform/cli";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { refuseUnlessConfirmed, withDangerDb } from "./lib/danger-run";
import { cliDescriptions, parseTwoFactorResetArgs } from "./web-two-factor-reset-args";

const log = createLog("web-two-factor-reset");
const failed = (error: unknown): void => log.error("two_factor_reset_failed", { ...errorFields(error) });

// Prints ids and counts only, never an address or the organization name. Refuses unless `--confirm` matches the
// organization name (docs/cli.md § Risk classes): the check runs before the reset writes.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseTwoFactorResetArgs(argv);
  return withDangerDb(failed, out, async (db) => {
    const refused = await refuseUnlessConfirmed(db, args.orgId, args.confirm, out);
    if (refused !== null) return refused;
    const result = await resetTwoFactor(
      db,
      { orgId: args.orgId },
      { userId: args.userId, actor: "cli", now: new Date() }
    );
    if (result.kind === "not_member") {
      out.writeErr("user is not a member of this organization\n");
      return 1;
    }
    const off = result.hadTwoFactor ? "" : " (it was off)";
    out.write(`user ${args.userId}: two-factor sign-in reset; ${result.sessionsEnded} sessions ended${off}\n`);
    if (result.breakGlassCleared.length > 0) {
      out.write(`user ${args.userId}: break-glass cleared in ${result.breakGlassCleared.join(", ")}\n`);
    }
    return 0;
  });
};

if (import.meta.main) {
  await runCli({ prefix: "web-two-factor-reset", descriptions: cliDescriptions, main });
}
