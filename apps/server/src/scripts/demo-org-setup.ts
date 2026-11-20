// Makes the demo organization that the docs shots (and the demo recording) sign in to: imports a demo seed file, then gives the
// owner a password and the accepted terms. It runs as a command from the shot setup, like `e2e-seed.ts`, and is also a function
// that the integration test calls.
//
// The import is `importDemo` with `replace: true` (a rerun on the same database works): the address scan and the host check of
// the import run before anything is written. The owner is made without a password; the password goes in through the reset path
// of the auth module with the current terms version, the way `e2e-seed.ts` sets the password of its users. No SQL here.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { TERMS_VERSION } from "@ea/core";

import { importDemo, parseDemoSeed, readSeedFile } from "../modules/lab";
import { createAuth } from "../platform/auth";
import { type CliSpec, runCli } from "../platform/cli";
import { loadConfig } from "../platform/config";
import { assertAppRole, createDb, type Db } from "../platform/db";
import { auditWebEvent, termsAcceptedHandler } from "../web";

import { cliDescriptions, parseDemoOrgSetupArgs } from "./demo-org-setup-args";
import { seedTargetOk } from "./e2e-seed-args";

// An address that is not an e2e seed user (the e2e wipe deletes those), on a `.test` host (the import scan accepts it).
export const DEMO_OWNER_EMAIL = "demo-owner@demo.test";
// A test value, not a secret: the demo organization holds synthetic data and lives in the e2e database only.
export const DEMO_OWNER_PASSWORD = "demo-correct-horse-battery";

export interface DemoWebSettings {
  databaseUrl: string;
  baseUrl: string;
  secret: string;
}

export interface SetupDemoOrgOptions {
  seedFile: string;
  ownerPassword: string;
  /** The auth settings. Absent: the web settings of the environment (`DATABASE_URL`, `WEB_BASE_URL`, `WEB_AUTH_SECRET`). */
  web?: DemoWebSettings;
  /** `SEND_SCOPE` of the environment (`all` refuses the import). Absent: the environment, else `off`. */
  sendScope?: string;
}

export interface SetupDemoOrgResult {
  orgId: string;
  ownerEmail: string;
}

function webSettings(): DemoWebSettings {
  const config = loadConfig();
  if (config.WEB_BASE_URL === undefined || config.WEB_AUTH_SECRET === undefined)
    throw new Error("web_settings_missing");
  return { databaseUrl: config.DATABASE_URL, baseUrl: config.WEB_BASE_URL, secret: config.WEB_AUTH_SECRET };
}

/**
 * Imports the seed file as the demo organization (an earlier import is replaced), then sets the owner's password and accepts
 * the current terms. A seed that the import refuses (`non_test_address`, `real_host`, a bad shape) throws a `DemoSeedError`
 * and nothing is imported; the password step runs only after a successful import.
 */
export async function setupDemoOrg(db: Db, options: SetupDemoOrgOptions): Promise<SetupDemoOrgResult> {
  const text = readSeedFile(options.seedFile);
  if (text === undefined) throw new Error("demo_seed_unreadable");
  const imported = await importDemo(db, parseDemoSeed(text), {
    ownerEmail: DEMO_OWNER_EMAIL,
    replace: true,
    sendScope: options.sendScope ?? process.env.SEND_SCOPE ?? "off",
  });

  const web = options.web ?? webSettings();
  const resets: { url: string }[] = [];
  const handle = createAuth({
    databaseUrl: web.databaseUrl,
    baseUrl: web.baseUrl,
    secret: web.secret,
    trustedOrigins: [web.baseUrl],
    onEvent: auditWebEvent(db),
    onTermsAccepted: termsAcceptedHandler(db, () => new Date()),
    resetLinkTtlSeconds: 86_400,
    sendResetPassword: async (reset) => {
      resets.push(reset);
    },
  });
  try {
    await handle.auth.api.requestPasswordReset({
      body: { email: DEMO_OWNER_EMAIL, redirectTo: `${web.baseUrl}/setup` },
    });
    const url = resets[0]?.url;
    if (url === undefined) throw new Error("no reset link was produced");
    const token = new URL(url).pathname.split("/").pop() ?? "";
    // The terms version rides in the body, as the e2e seed sets it; a variable keeps the typed body of the API out of the way.
    const body = { newPassword: options.ownerPassword, token, termsVersion: TERMS_VERSION };
    await handle.auth.api.resetPassword({ body });
  } finally {
    await handle.close();
  }
  return { orgId: imported.orgId, ownerEmail: DEMO_OWNER_EMAIL };
}

/** The file that the shot spec and the demo recording read to sign in as the demo owner (`apps/web/e2e/.demo-owner.json`). */
export interface DemoOwnerFile {
  orgId: string;
  owner: { email: string; password: string };
}

/** Writes the owner's sign-in for the e2e specs. The password is the test value of this command, not a secret. */
export function writeDemoOwnerFile(path: string, result: SetupDemoOrgResult, password: string): DemoOwnerFile {
  const file: DemoOwnerFile = { orgId: result.orgId, owner: { email: result.ownerEmail, password } };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return file;
}

const main: CliSpec["main"] = async (argv, out) => {
  const args = parseDemoOrgSetupArgs(argv);
  const config = loadConfig();
  // The same database guard as the e2e seed: only a database named `*_e2e` takes a demo organization with a known password.
  const target = seedTargetOk(config.DATABASE_URL, process.env.MIGRATOR_DATABASE_URL ?? "");
  if (!target.ok) {
    out.fail(`refusing: ${target.reason}`);
    return 1;
  }
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const result = await setupDemoOrg(db, { seedFile: args.seed, ownerPassword: DEMO_OWNER_PASSWORD });
    writeDemoOwnerFile(args.out, result, DEMO_OWNER_PASSWORD);
    out.print(`demo org ${result.orgId} ready`);
    return 0;
  } finally {
    await db.destroy();
  }
};

if (import.meta.main) {
  await runCli({ prefix: "demo-org-setup", descriptions: cliDescriptions, main });
}
