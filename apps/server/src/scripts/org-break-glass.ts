import {
  clearBreakGlassOwner,
  getOrganization,
  getUserAuthProfile,
  listMemberships,
  setBreakGlassOwner,
} from "../modules/tenancy";
import { runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { errorFields } from "../platform/errors";
import { createLog } from "../platform/log";

import { refuseUnlessConfirmed, withDangerDb } from "./lib/danger-run";
import { cliDescriptions, parseOrgBreakGlassArgs } from "./org-break-glass-args";

const log = createLog("org-break-glass");
const failed = (error: unknown): void => log.error("org_break_glass_failed", { ...errorFields(error) });

const word = (value: boolean, yes: string, no: string): string => (value ? yes : no);

// Prints ids and words only, never an address or a name. The set and the clear read the organization first and
// refuse unless `--confirm` matches its name (docs/cli.md § Risk classes). The list changes nothing.
const main: CliSpec["main"] = async (argv, out: CliRawOutput) => {
  const args = parseOrgBreakGlassArgs(argv);
  const line = (text: string): void => out.write(`${text}\n`);
  const fail = (text: string): number => {
    out.writeErr(`${text}\n`);
    return 1;
  };

  return withDangerDb(failed, out, async (db) => {
    const ctx = { orgId: args.orgId };
    const now = new Date();

    if (args.mode === "list") {
      if (!(await getOrganization(db, ctx))) return fail("organization not found");
      for (const member of await listMemberships(db, ctx)) {
        if (member.role !== "owner") continue;
        const profile = await getUserAuthProfile(db, member.user_id);
        line(
          `owner ${member.user_id}: two-factor ${word(profile?.twoFactorEnabled === true, "on", "off")}, break-glass ${word(member.break_glass, "yes", "no")}`
        );
      }
      return 0;
    }

    const refused = await refuseUnlessConfirmed(db, args.orgId, args.confirm, out);
    if (refused !== null) return refused;

    if (args.mode === "clear") {
      const result = await clearBreakGlassOwner(db, ctx, { actor: "cli", now, reason: "cli" });
      switch (result.kind) {
        case "cleared":
          line(`org ${args.orgId}: break-glass owner ${result.userId} cleared`);
          return 0;
        case "none":
          line(`org ${args.orgId}: no break-glass owner`);
          return 0;
        case "not_found":
          return fail("organization not found");
      }
    }

    const result = await setBreakGlassOwner(db, ctx, { userId: args.userId, actor: "cli", now });
    switch (result.kind) {
      case "set":
        line(
          `org ${args.orgId}: break-glass owner ${args.userId}${result.replaced === null ? "" : ` (was ${result.replaced})`}`
        );
        return 0;
      case "unchanged":
        line(`org ${args.orgId}: ${args.userId} is already the break-glass owner`);
        return 0;
      case "not_found":
        return fail("organization not found");
      case "not_owner":
        return fail("user is not an owner of this organization");
      case "no_two_factor":
        return fail("user has no two-factor sign-in: they turn it on in Settings → Account first");
    }
  });
};

if (import.meta.main) {
  await runCli({ prefix: "org-break-glass", descriptions: cliDescriptions, main });
}
