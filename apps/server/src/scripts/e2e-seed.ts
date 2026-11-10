import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Client } from "pg";

import { createOrganizationWithOwner, insertMembership, insertUser } from "../modules/tenancy";
import { createAuth } from "../platform/auth";
import { loadConfig, webTrustedOrigins } from "../platform/config";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";
import { auditWebEvent } from "../web";

import {
  E2E_ASSISTANT_EMAILS,
  E2E_OWNER_EMAIL,
  E2E_OWNER_PASSWORD,
  E2E_ORG_NAME,
  E2E_PROJECTS,
  type E2eProject,
  type SeedFile,
  seedFilePath,
  seedTargetOk,
} from "./e2e-seed-args";

const log = createLog("e2e-seed");

const repoRoot = resolve(import.meta.dir, "../../../..");

async function wipe(migratorUrl: string): Promise<void> {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    // The organization cascade removes mailboxes, mail, actions, memberships and audit rows.
    await client.query("DELETE FROM organizations WHERE name = $1", [E2E_ORG_NAME]);
    // Users are global: the cascade leaves them.
    await client.query("DELETE FROM users WHERE email = ANY($1)", [
      [E2E_OWNER_EMAIL, ...E2E_PROJECTS.map((project) => E2E_ASSISTANT_EMAILS[project])],
    ]);
    // Tokens left by a half-failed run.
    await client.query("DELETE FROM auth_verifications WHERE value NOT IN (SELECT id::text FROM users)");
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  const config = loadConfig();
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL ?? "";
  const target = seedTargetOk(config.DATABASE_URL, migratorUrl);
  if (!target.ok) {
    log.error(`refusing: ${target.reason}`);
    return 1;
  }
  const baseUrl = config.WEB_BASE_URL;
  const secret = config.WEB_AUTH_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    log.error("refusing: WEB_BASE_URL is empty");
    return 1;
  }

  // The role check fails before the destructive wipe when DATABASE_URL points at the wrong role.
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);

    await wipe(migratorUrl);

    const resets: { userId: string; url: string }[] = [];
    const handle = createAuth({
      databaseUrl: config.DATABASE_URL,
      baseUrl,
      secret,
      trustedOrigins: [baseUrl, ...webTrustedOrigins(config)],
      onEvent: auditWebEvent(db),
      sendResetPassword: async (reset) => {
        resets.push(reset);
      },
    });
    try {
      const owner = await createOrganizationWithOwner(db, {
        orgName: E2E_ORG_NAME,
        timezone: "Europe/Warsaw",
        email: E2E_OWNER_EMAIL,
        displayName: "E2E Owner",
      });
      const assistantIds = {} as Record<E2eProject, string>;
      for (const project of E2E_PROJECTS) {
        const user = await insertUser(db, {
          email: E2E_ASSISTANT_EMAILS[project],
          displayName: `E2E Assistant ${project}`,
        });
        await insertMembership(db, { orgId: owner.orgId }, { userId: user.id, role: "assistant" });
        assistantIds[project] = user.id;
      }

      // Takes the link of the last reset request for an e-mail address.
      const requestLink = async (email: string): Promise<string> => {
        resets.length = 0;
        await handle.auth.api.requestPasswordReset({ body: { email, redirectTo: `${baseUrl}/setup` } });
        const url = resets[0]?.url;
        if (url === undefined) throw new Error("no reset link was produced");
        return url;
      };

      const ownerLink = await requestLink(E2E_OWNER_EMAIL);
      const token = new URL(ownerLink).pathname.split("/").pop() ?? "";
      await handle.auth.api.resetPassword({ body: { newPassword: E2E_OWNER_PASSWORD, token } });

      const assistants = {} as SeedFile["assistants"];
      for (const project of E2E_PROJECTS) {
        const email = E2E_ASSISTANT_EMAILS[project];
        assistants[project] = { userId: assistantIds[project], email, setupUrl: await requestLink(email) };
      }

      const seed: SeedFile = {
        orgId: owner.orgId,
        owner: { userId: owner.userId, email: E2E_OWNER_EMAIL, password: E2E_OWNER_PASSWORD },
        assistants,
      };
      const path = seedFilePath(repoRoot);
      await mkdir(dirname(path), { recursive: true });
      // An old file may have wider permissions: remove it so the new one is never readable by others.
      await rm(path, { force: true });
      await writeFile(path, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });

      log.info(
        `seeded org ${seed.orgId} owner ${seed.owner.userId} assistants ${E2E_PROJECTS.map((project) => assistantIds[project]).join(",")}`
      );
      return 0;
    } finally {
      await handle.close();
    }
  } finally {
    await db.destroy();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error(`failed: ${describeError(error)}`);
    process.exit(1);
  });
