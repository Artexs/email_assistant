import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

// The server and the one-off `cli` hold no database admin key. `docker compose config` inlines the `env_file` values, so the
// config shows what a container would get. The CLI needs no daemon.

const deployDir = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "compose-server-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const keysOutput = Bun.spawnSync([
  "bash",
  "-c",
  `source "${join(deployDir, "compose-lib.sh")}"; echo "\${EA_D5_KEYS[@]}"`,
]);
const ADMIN_KEYS = keysOutput.stdout.toString().trim().split(" ");

const SENTINEL = { postgres: "sentinel-p-81", migrator: "sentinel-m-81", app: "sentinel-a-81" };

interface Resolved {
  services: Record<string, { image?: string; environment?: Record<string, string | null> }>;
}

// A project folder with the real compose file (or a changed copy), a `.env` without admin keys and a db.env with sentinels.
function project(name: string, composeText: string): string {
  const root = join(dir, name);
  mkdirSync(join(root, "deploy"), { recursive: true });
  writeFileSync(join(root, "deploy", "compose.yaml"), composeText);
  writeFileSync(join(root, ".env"), "CREDENTIALS_KEY=sentinel-k-81\nLOG_LEVEL=info\n");
  writeFileSync(
    join(root, "deploy", "db.env"),
    `POSTGRES_PASSWORD=${SENTINEL.postgres}\nMIGRATOR_PASSWORD=${SENTINEL.migrator}\nAPP_PASSWORD=${SENTINEL.app}\n`
  );
  return root;
}

function resolve(root: string): Resolved {
  const result = Bun.spawnSync(
    [
      "docker",
      "compose",
      "-f",
      "deploy/compose.yaml",
      "--env-file",
      "deploy/db.env",
      "--profile",
      "cli",
      "--profile",
      "ops",
      "config",
      "--format",
      "json",
    ],
    { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: root } }
  );
  if (result.exitCode !== 0)
    throw new Error(`docker compose config exited ${result.exitCode}: ${result.stderr.toString()}`);
  return JSON.parse(result.stdout.toString()) as Resolved;
}

// Every service that runs the server image, except `migrate`, with the admin keys it holds. No service is named: a new one is checked too.
function adminKeysOutsideMigrate(config: Resolved): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [name, service] of Object.entries(config.services)) {
    if (service.image !== "ea-server" || name === "migrate") continue;
    found[name] = ADMIN_KEYS.filter((key) => key in (service.environment ?? {}));
  }
  return found;
}

const composeText = readFileSync(join(deployDir, "compose.yaml"), "utf8");
const real = resolve(project("real", composeText));

describe("deploy/compose.yaml server env", () => {
  test("server and cli hold no admin key, DATABASE_URL names the app role, migrate keeps its migrator URL", () => {
    for (const name of ["server", "cli"]) {
      const env = real.services[name]?.environment ?? {};
      for (const key of ADMIN_KEYS) expect(env, `${name} ${key}`).not.toHaveProperty(key);
    }
    const databaseUrl = new URL(real.services.server?.environment?.DATABASE_URL ?? "");
    expect(databaseUrl.username).toBe("app");
    expect(new URL(real.services.cli?.environment?.DATABASE_URL ?? "").username).toBe("app");
    const migrate = real.services.migrate?.environment ?? {};
    expect(Object.keys(migrate).sort()).toEqual(["LOG_FORMAT", "MIGRATOR_DATABASE_URL"]);
    expect(new URL(migrate.MIGRATOR_DATABASE_URL ?? "").username).toBe("migrator");
  });

  test("the postgres and migrator passwords reach only db and migrate; the app password reaches server and cli only in DATABASE_URL", () => {
    const holders = (secret: string): string[] =>
      Object.entries(real.services)
        .filter(([, service]) => JSON.stringify(service).includes(secret))
        .map(([name]) => name)
        .sort();
    expect(holders(SENTINEL.postgres)).toEqual(["db"]);
    expect(holders(SENTINEL.migrator)).toEqual(["db", "migrate"]);
    expect(holders(SENTINEL.app)).toEqual(["cli", "db", "server"]);
    for (const name of ["server", "cli"]) {
      const { DATABASE_URL, ...rest } = real.services[name]?.environment ?? {};
      expect(DATABASE_URL).toContain(SENTINEL.app);
      expect(JSON.stringify(rest), name).not.toContain(SENTINEL.app);
    }
  });

  test("every service on the server image, except migrate, has no admin key; a key added to a new one is found", () => {
    const names = Object.keys(adminKeysOutsideMigrate(real)).sort();
    expect(names).toEqual(["cli", "server"]);
    expect(Object.values(adminKeysOutsideMigrate(real)).flat()).toEqual([]);

    const extra = composeText.replace(
      "\nservices:\n",
      `\nservices:\n  worker:\n    image: ea-server\n    environment:\n      MIGRATOR_DATABASE_URL: postgres://migrator:x@db/x\n`
    );
    expect(extra).not.toBe(composeText);
    expect(adminKeysOutsideMigrate(resolve(project("extra", extra))).worker).toEqual(["MIGRATOR_DATABASE_URL"]);
  });
});
