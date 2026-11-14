import { resetTwoFactor } from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseTwoFactorResetArgs, usage } from "./web-two-factor-reset-args";

const log = createLog("web-two-factor-reset");

// Prints ids and counts only, never an address or the organization name. Returns the exit code.
async function main(): Promise<number> {
  const args = parseTwoFactorResetArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(`${usage}\n`);
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await resetTwoFactor(
      db,
      { orgId: args.orgId },
      { userId: args.userId, actor: "cli", now: new Date() }
    );
    if (result.kind === "not_member") {
      process.stderr.write("user is not a member of this organization\n");
      return 1;
    }
    const off = result.hadTwoFactor ? "" : " (it was off)";
    process.stdout.write(
      `user ${args.userId}: two-factor sign-in reset; ${result.sessionsEnded} sessions ended${off}\n`
    );
    if (result.breakGlassCleared.length > 0) {
      process.stdout.write(`user ${args.userId}: break-glass cleared in ${result.breakGlassCleared.join(", ")}\n`);
    }
    return 0;
  } catch (error) {
    log.error("two_factor_reset_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("two_factor_reset_failed", { ...errorFields(error) });
    process.exit(1);
  });
