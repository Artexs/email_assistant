import { featureKeys } from "@ea/core";

import { configureFeatures, featureStates, getOrganization, setOrgFeature } from "../modules/tenancy";
import { createCliOutput } from "../platform/cli";
import { featuresOff, loadConfig } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { parseOrgFlagArgs, usage } from "./org-flag-args";

const out = createCliOutput("org-flag");

const state = (enabled: boolean): string => (enabled ? "on" : "off");

// Prints ids, flag keys, on/off and sources only, never the organization name. Returns the exit code.
async function main(): Promise<number> {
  const args = parseOrgFlagArgs(process.argv.slice(2));
  if (!args) {
    out.fail(usage);
    return 1;
  }

  const config = loadConfig();
  const killed = featuresOff(config);
  configureFeatures({ off: killed });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const ctx = { orgId: args.orgId };

    if (args.mode === "list") {
      if (!(await getOrganization(db, ctx))) {
        out.fail("organization not found");
        return 1;
      }
      for (const { flag, enabled, source } of await featureStates(db, ctx)) {
        out.print(`org ${args.orgId}: ${flag} ${state(enabled)} (${source})`);
      }
      return 0;
    }

    const result = await setOrgFeature(db, ctx, {
      flag: args.flag,
      enabled: args.enabled,
      actor: "cli",
      now: new Date(),
    });
    switch (result.kind) {
      case "changed":
        out.print(
          `org ${args.orgId}: flag ${result.flag} ${result.before === null ? "unset" : state(result.before)} → ${state(result.enabled)}`
        );
        break;
      case "unchanged":
        out.print(`org ${args.orgId}: flag ${result.flag} already ${state(result.enabled)}, no change`);
        break;
      case "unknown_flag":
        out.fail(`unknown flag; known flags: ${featureKeys.join(", ")}`);
        return 1;
      case "not_found":
        out.fail("organization not found");
        return 1;
    }
    if (result.warning === "sso_required_on") {
      out.print("warning: sso_required is on; only the break-glass owner can sign in");
    }
    if (killed.some((key) => key === result.flag)) {
      out.print(`(FEATURES_OFF holds ${result.flag}: it reads off everywhere)`);
    }
    return 0;
  } catch (error) {
    out.fail(`failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    out.fail(`failed: ${describeError(error)}`);
    process.exit(1);
  });
