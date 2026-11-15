import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// F114 stage 07, test 8: `deploy/compose.drill.yaml` over `deploy/compose.yaml`, read through `docker compose config` (the CLI, no
// daemon). The temp tree is a fresh clone: it has a `.env` full of live sentinels (the drill must not read it) and a drill.env.

const deployDir = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "f114-s07-drill-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Resolved {
  name: string;
  networks: { default: { ipam: { config: { subnet: string; gateway: string }[] } } };
  volumes: Record<string, { name?: string }>;
  services: Record<
    string,
    {
      image?: string;
      ports?: unknown[] | null;
      logging?: { driver: string; options: Record<string, string> };
      environment?: Record<string, string | null>;
      env_file?: unknown;
      profiles?: string[];
    }
  >;
}

const config = (files: string[], project: string[] = ["-p", "ea-drill"]): Resolved => {
  const args = ["compose", ...project, ...files.flatMap((f) => ["-f", f]), "--env-file", "deploy/drill.env"];
  const result = Bun.spawnSync(["docker", ...args, "--profile", "*", "config", "--format", "json"], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", HOME: dir },
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString()) as Resolved;
};

// The services of compose.yaml that run the server image: `server` and each one that extends it.
const serverImageServices = (): string[] => {
  const base = Bun.YAML.parse(readFileSync(join(deployDir, "compose.yaml"), "utf8")) as {
    services: Record<string, { extends?: { service?: string } }>;
  };
  return Object.entries(base.services)
    .filter(([name, service]) => name === "server" || service.extends?.service === "server")
    .map(([name]) => name);
};

let drill: Resolved;
beforeAll(() => {
  mkdirSync(join(dir, "deploy"), { recursive: true });
  mkdirSync(join(dir, "db"));
  for (const name of ["compose.yaml", "compose.drill.yaml"])
    copyFileSync(join(deployDir, name), join(dir, "deploy", name));
  writeFileSync(join(dir, "db", "roles.sql"), "");
  // Live values: none of them may reach the drill. The drill.env also tries to set a forced key.
  writeFileSync(
    join(dir, ".env"),
    [
      "LIVE_ONLY_SENTINEL=live-secret",
      "TELEGRAM_BOT_TOKEN=live-token",
      "GEMINI_API_KEY=live-gemini",
      "OPENAI_API_KEY=live-openai",
      "HEARTBEAT_URL=https://hc.invalid/live",
      "SEND_SCOPE=all",
      "POSTGRES_PASSWORD=live-pg",
    ].join("\n")
  );
  writeFileSync(
    join(dir, "deploy", "drill.env"),
    [
      "POSTGRES_PASSWORD=drill-pg",
      "MIGRATOR_PASSWORD=drill-migrator",
      "APP_PASSWORD=drill-app",
      "CREDENTIALS_KEY=drill-key",
      "TELEGRAM_BOT_TOKEN=from-drill-env",
      "TRIAGE_LLM_SCOPE=all",
    ].join("\n")
  );
  drill = config(["deploy/compose.yaml", "deploy/compose.drill.yaml"]);
});

describe("deploy/compose.drill.yaml", () => {
  test("the project is ea-drill, with its own volume and the subnet 172.29.0.0/24 (not the live 172.30.0.0/24)", () => {
    expect(drill.name).toBe("ea-drill");
    expect(drill.volumes["db-data"]?.name).toBe("ea-drill_db-data");
    expect(drill.networks.default.ipam.config).toEqual([{ subnet: "172.29.0.0/24", gateway: "172.29.0.1" }]);
  });

  test("the file names the project itself: without -p the project is ea-drill, not email-assistant", () => {
    expect(config(["deploy/compose.yaml", "deploy/compose.drill.yaml"], []).name).toBe("ea-drill");
  });

  test("the server image services are server and cli, and each one has the drill block", () => {
    const names = serverImageServices();
    expect(names).toEqual(expect.arrayContaining(["server", "cli"]));
    for (const name of names) {
      const service = drill.services[name];
      expect(service, name).toBeDefined();
      expect(service?.image, name).toBe("ea-drill-server");
      expect(service?.ports ?? [], name).toEqual([]);
      expect(service?.logging?.driver, name).toBe("local");
      expect(service?.logging?.options, name).toEqual({ "max-size": "10m", "max-file": "5" });
    }
  });

  test("the drill file does not name the log store services, and they stay behind the profile ops", () => {
    // The log store services stay behind their profile; the drill file does not name them.
    const text = readFileSync(join(deployDir, "compose.drill.yaml"), "utf8");
    for (const name of ["victorialogs", "vlagent"]) expect(text).not.toContain(name);
    for (const name of ["victorialogs", "vlagent"]) expect(drill.services[name]?.profiles).toEqual(["ops"]);
  });

  test("the live .env is never read: only drill.env feeds the server image services; the live sentinels are absent", () => {
    for (const name of serverImageServices()) {
      const env = drill.services[name]?.environment ?? {};
      expect(env.LIVE_ONLY_SENTINEL, name).toBeUndefined();
      expect(env.POSTGRES_PASSWORD, name).toBe("drill-pg");
      expect(env.CREDENTIALS_KEY, name).toBe("drill-key");
      expect(JSON.stringify(drill.services[name]), name).not.toContain("live-");
    }
  });

  test("the channels and the scopes are forced, even when drill.env or the live env sets them", () => {
    for (const name of serverImageServices()) {
      const env = drill.services[name]?.environment ?? {};
      for (const key of [
        "TELEGRAM_BOT_TOKEN",
        "HEARTBEAT_URL",
        "OPERATOR_TELEGRAM_CHAT_ID",
        "WEB_BASE_URL",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
        "OPENAI_OWN_API_KEY",
      ]) {
        expect(env[key], `${name} ${key}`).toBe("");
      }
      for (const key of ["TRIAGE_LLM_SCOPE", "ACTIONS_SCOPE", "SEND_SCOPE"])
        expect(env[key], `${name} ${key}`).toBe("off");
    }
  });

  test("the db service publishes no port and keeps the shared postgres:17 image", () => {
    expect(drill.services.db?.ports ?? []).toEqual([]);
    expect(drill.services.db?.image).toBe("postgres:17");
  });
});
