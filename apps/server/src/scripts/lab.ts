import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { llmRoles } from "@ea/core";

import { settingsDeps } from "../composition";
import {
  buildServeParts,
  createFakeTgClient,
  createLabState,
  createServeMailClient,
  labEnvIssues,
  loadLabCorpus,
  orgHasMail,
  readServeStatus,
  runServe,
  runSpend,
  SERVE_EVERY_MS,
  SERVE_HEARTBEAT_MS,
  seedLabOrg,
  storeRunUrgencyProfile,
  takeServeLock,
  writeServeStatus,
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

// Resolves after `ms`, or at once when the signal aborts.
function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolveSleep();
      },
      { once: true }
    );
  });
}

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
      models: LAB_ROLES.map((role) => ({
        model: table.roles[role].model,
        endpoint: table.providers[table.roles[role].provider].endpoint,
      })),
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
      serveStatus: () => readServeStatus(stateDir),
      serve: () => {
        // The env guard has run before: a loopback root is set.
        if (config.TELEGRAM_API_ROOT === undefined) throw new Error("TELEGRAM_API_ROOT is not set");
        const { parts, spendOf } = buildServeParts({
          db,
          state,
          corpus,
          mail: createServeMailClient(corpus),
          tg: createFakeTgClient(config.TELEGRAM_API_ROOT),
          settings: settingsDeps(db, () => new Date()),
          now: () => new Date(),
        });
        // SIGTERM and SIGINT end the tick after the part that runs, release the lock and exit 0.
        const stop = new AbortController();
        for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop.abort());
        return runServe(
          {
            state,
            parts,
            now: () => new Date(),
            spendUsd: async (runId) => {
              const spend = await spendOf(runId);
              return spend.kind === "unpriced" ? "unpriced" : spend.usd;
            },
            say: (line) => cli.print(line),
            heartbeat: (status) => writeServeStatus(stateDir, status),
            envIssues: () => labEnvIssues(process.env, corpus),
            takeLock: () => takeServeLock(stateDir),
            sleep: sleepUnlessAborted,
            heartbeatEveryMs: SERVE_HEARTBEAT_MS,
          },
          { everyMs: SERVE_EVERY_MS, signal: stop.signal }
        );
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
