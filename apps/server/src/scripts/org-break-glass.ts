import {
  clearBreakGlassOwner,
  getOrganization,
  getUserAuthProfile,
  listMemberships,
  setBreakGlassOwner,
} from "../modules/tenancy";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { parseOrgBreakGlassArgs, usage } from "./org-break-glass-args";

const log = createLog("org-break-glass");

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const fail = (line: string): number => {
  process.stderr.write(`${line}\n`);
  return 1;
};
const word = (value: boolean, yes: string, no: string): string => (value ? yes : no);

// Prints ids and words only, never an address or a name. Returns the exit code.
async function main(): Promise<number> {
  const args = parseOrgBreakGlassArgs(process.argv.slice(2));
  if (!args) return fail(usage);

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: args.orgId };
    const now = new Date();

    if (args.mode === "list") {
      if (!(await getOrganization(db, ctx))) return fail("organization not found");
      for (const member of await listMemberships(db, ctx)) {
        if (member.role !== "owner") continue;
        const profile = await getUserAuthProfile(db, member.user_id);
        out(
          `owner ${member.user_id}: two-factor ${word(profile?.twoFactorEnabled === true, "on", "off")}, break-glass ${word(member.break_glass, "yes", "no")}`
        );
      }
      return 0;
    }

    if (args.mode === "clear") {
      const result = await clearBreakGlassOwner(db, ctx, { actor: "cli", now, reason: "cli" });
      switch (result.kind) {
        case "cleared":
          out(`org ${args.orgId}: break-glass owner ${result.userId} cleared`);
          return 0;
        case "none":
          out(`org ${args.orgId}: no break-glass owner`);
          return 0;
        case "not_found":
          return fail("organization not found");
      }
    }

    const result = await setBreakGlassOwner(db, ctx, { userId: args.userId, actor: "cli", now });
    switch (result.kind) {
      case "set":
        out(
          `org ${args.orgId}: break-glass owner ${args.userId}${result.replaced === null ? "" : ` (was ${result.replaced})`}`
        );
        return 0;
      case "unchanged":
        out(`org ${args.orgId}: ${args.userId} is already the break-glass owner`);
        return 0;
      case "not_found":
        return fail("organization not found");
      case "not_owner":
        return fail("user is not an owner of this organization");
      case "no_two_factor":
        return fail("user has no two-factor sign-in: they turn it on in Settings → Account first");
    }
  } catch (error) {
    log.error("org_break_glass_failed", { ...errorFields(error) });
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error("org_break_glass_failed", { ...errorFields(error) });
    process.exit(1);
  });
