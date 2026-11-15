import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { llmRoles } from "@ea/core";

import { createLabState, loadLabCorpus, orgHasMail, runSpend } from "../modules/lab";
import { createCliOutput } from "../platform/cli";
import { loadConfig, llmRoleTable } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { parseLabArgs, usage } from "./lab-args";
import { runLabCommand } from "./lab-run";

const cli = createCliOutput("lab");

const SCENARIO = "lab-01";
const SIM_ROOT = resolve(import.meta.dir, "../../../../evals/sim");
// The lab runs no judge: its model is not a cost of a live run.
const LAB_ROLES = llmRoles.filter((role) => role !== "judge");

async function main(): Promise<number> {
  const command = parseLabArgs(process.argv.slice(2));
  if (!command) {
    cli.fail(usage);
    return 1;
  }

  const stateDir = process.env.LAB_STATE_DIR ?? "";
  if (!isAbsolute(stateDir)) {
    cli.fail("refused: LAB_STATE_DIR must be an absolute path");
    return 1;
  }

  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const state = createLabState(stateDir, () => new Date());
    const table = llmRoleTable(config);
    return await runLabCommand(command, {
      env: process.env,
      state,
      corpus: await loadLabCorpus(SIM_ROOT, SCENARIO),
      models: LAB_ROLES.map((role) => table.roles[role].model),
      orgHasMail: (orgId) => orgHasMail(db, orgId),
      spendOf: async (runId) => {
        const run = state.readRun(runId);
        const org = state.readOrgs()[run.org];
        if (org === undefined) throw new Error("lab state: the run org is not in orgs.json");
        return runSpend(db, org.orgId, run);
      },
      now: () => new Date(),
      hex4: () => randomUUID().replaceAll("-", "").slice(0, 4),
      cli,
    });
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    cli.fail(describeError(error));
    process.exit(1);
  });
