import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { llmRoles } from "@ea/core";

import { settingsDeps } from "../composition";
import {
  createFakeTgClient,
  createLabState,
  loadLabCorpus,
  orgHasMail,
  runSpend,
  seedLabOrg,
  storeRunUrgencyProfile,
} from "../modules/lab";
import { configureMailHosts, openImapProvider, verifySmtpLogin } from "../modules/mail";
import { createCliOutput } from "../platform/cli";
import { loadConfig, llmRoleTable, mailAllowLocal } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";

import { parseLabArgs, usage } from "./lab-args";
import { runLabCommand } from "./lab-run";

const cli = createCliOutput("lab");

const SCENARIO = "lab-01";
const SIM_ROOT = resolve(import.meta.dir, "../../../../evals/sim");
// The lab runs no judge: its model is not a cost of a live run.
const LAB_ROLES = llmRoles.filter((role) => role !== "judge");
// Seed waits this long for the server to link the fake chat after `/start`.
const LINK_TIMEOUT_MS = 60_000;
const LINK_POLL_MS = 1000;

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
  // The lab mailbox host is 127.0.0.1 (GreenMail shares the namespace of the stack); the env guard has already required local hosts.
  configureMailHosts({ allowLocal: mailAllowLocal(config) });
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const state = createLabState(stateDir, () => new Date());
    const table = llmRoleTable(config);
    const corpus = await loadLabCorpus(SIM_ROOT, SCENARIO);
    return await runLabCommand(command, {
      env: process.env,
      state,
      corpus,
      models: LAB_ROLES.map((role) => table.roles[role].model),
      orgHasMail: (orgId) => orgHasMail(db, orgId),
      seed: (target) => {
        // The env guard has run before: a loopback root is set.
        if (config.TELEGRAM_API_ROOT === undefined) throw new Error("TELEGRAM_API_ROOT is not set");
        return seedLabOrg(
          {
            db,
            connect: {
              db,
              secrets: createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION),
              openProvider: openImapProvider,
              verifySmtp: verifySmtpLogin,
            },
            settings: settingsDeps(db, () => new Date()),
            state,
            tg: createFakeTgClient(config.TELEGRAM_API_ROOT),
            now: () => new Date(),
            sleep: (ms) => Bun.sleep(ms),
            linkTimeoutMs: LINK_TIMEOUT_MS,
            pollMs: LINK_POLL_MS,
          },
          corpus.scenario,
          target
        );
      },
      storeUrgency: (org, plan) => storeRunUrgencyProfile({ db, scenario: corpus.scenario }, org, plan),
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
