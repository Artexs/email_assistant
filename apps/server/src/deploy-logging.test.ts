import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

// deploy/check-logging.sh wants `server` on json-file (the files the log store reads), every other service on
// `local`, and no document line that runs a one-off command in `server`. The script needs the `docker compose` CLI and jq, no daemon.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const script = join(repoRoot, "deploy", "check-logging.sh");
const dir = mkdtempSync(join(tmpdir(), "f103-s17-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const block = (driver: string): string =>
  `    logging: { driver: ${driver}, options: { max-size: 10m, max-file: "5" } }`;
const compose = (services: Record<string, string>): string =>
  `services:\n${Object.entries(services)
    .map(([name, logging]) => `  ${name}:\n    image: x\n${logging}\n`)
    .join("")}`;
const write = (name: string, content: string): string => {
  const path = join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
  return path;
};
const check = (args: string[], env: Record<string, string> = {}) => {
  const result = Bun.spawnSync(["bash", script, ...args], { cwd: repoRoot, env: { ...process.env, ...env } });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};
const passing = (): string => write("pass.yaml", compose({ server: block("json-file"), db: block("local") }));

describe("deploy/check-logging.sh", () => {
  test("passes on the compose files of the repo", () => {
    const result = check([]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("logging ok: server json-file; local: ");
  });

  test("fails when server is on local", () => {
    const path = write("server-local.yaml", compose({ server: block("local"), db: block("local") }));
    const result = check([path]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("server must be json-file");
  });

  test("fails when db is on json-file", () => {
    const path = write("db-json.yaml", compose({ server: block("json-file"), db: block("json-file") }));
    const result = check([path]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("db must be local");
  });

  test("fails when a service has no logging key", () => {
    const path = write("none.yaml", `services:\n  server:\n    image: x\n${block("json-file")}\n  db:\n    image: x\n`);
    const result = check([path]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("db must be local");
  });

  test("fails when a document line runs a one-off command in server, and prints the line number but not the line", () => {
    const docs = write("bad.md", "$C run -e KEY=val server bun run x\n");
    const result = check([passing()], { CHECK_LOGGING_DOCS: docs });
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${docs}:1:`);
    expect(result.err).not.toContain("KEY=val");
  });

  test("fails on an entrypoint form and on a command continued after a backslash", () => {
    const docs = write(
      "forms.md",
      "text\n$C run --rm --entrypoint bun server run x\n\n$C run --rm -T \\\n  server \\\n  bun run y\n"
    );
    const result = check([passing()], { CHECK_LOGGING_DOCS: docs });
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${docs}:2:`);
    expect(result.err).toContain(`${docs}:4:`);
  });

  test("passes on a continued cli command", () => {
    const docs = write("cont.md", "$C run --rm \\\n  cli \\\n  bun run y\n");
    expect(check([passing()], { CHECK_LOGGING_DOCS: docs }).code).toBe(0);
  });

  test("fails when cli has no profile, or its healthcheck is on", () => {
    const withCli = (name: string, extra: string): string =>
      write(name, compose({ server: block("json-file"), cli: block("local") }).replace("  cli:\n", `  cli:\n${extra}`));
    const noProfile = check([withCli("cli-a.yaml", "    healthcheck: { disable: true }\n")]);
    expect(noProfile.code).toBe(1);
    expect(noProfile.err).toContain("cli must have profiles [cli]");
    const healthy = check([withCli("cli-b.yaml", "    profiles: [cli]\n")]);
    expect(healthy.code).toBe(1);
    expect(healthy.err).toContain("cli healthcheck must be disabled");
    expect(check([withCli("cli-c.yaml", "    profiles: [cli]\n    healthcheck: { disable: true }\n")]).code).toBe(0);
  });

  test("passes when documents use cli, or exec in server", () => {
    const docs = write("good.md", "$C run --rm cli bun run x\n$C exec server bun run x\nthe server runs a job\n");
    const result = check([passing()], { CHECK_LOGGING_DOCS: docs });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
  });
});

describe("deploy/check-logging.sh --drill (restore drill file set, F114 stage 07)", () => {
  const drillCompose = (services: Record<string, { logging: string; extra?: string }>): string =>
    `services:\n${Object.entries(services)
      .map(([name, s]) => `  ${name}:\n    image: x\n${s.logging}\n${s.extra ?? ""}`)
      .join("")}`;

  test("passes on the real drill file set: every service local, no log store service outside a profile", () => {
    const result = check([]);
    expect(result.err).toBe("");
    expect(result.out).toContain("logging ok (drill): every service local; services: ");
  });

  test("a drill set with server on json-file fails (the drill must stay out of the log store)", () => {
    const path = write(
      "drill-json.yaml",
      drillCompose({ server: { logging: block("json-file") }, db: { logging: block("local") } })
    );
    const result = check(["--drill", path]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("server must be local");
  });

  test("a drill set passes with server on local and the store service behind a profile", () => {
    const path = write(
      "drill-ok.yaml",
      drillCompose({
        server: { logging: block("local") },
        db: { logging: block("local") },
        "store-tool": { logging: block("local"), extra: "    profiles: [ops]\n" },
      })
    );
    const result = check(["--drill", path]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
  });

  test("a drill set fails when a service outside db, server and cli has no profile, or has the profile cli", () => {
    for (const [name, extra] of [
      ["drill-noprofile.yaml", ""],
      ["drill-cliprofile.yaml", "    profiles: [cli, ops]\n"],
    ] as const) {
      const path = write(
        name,
        drillCompose({
          server: { logging: block("local") },
          "store-tool": { logging: block("local"), extra },
        })
      );
      const result = check(["--drill", path]);
      expect(result.code, name).toBe(1);
      expect(result.err, name).toContain("the drill must not run store-tool");
    }
  });

  test("12. both real drill files pass with migrate allowed; a copy where migrate has no profile fails", () => {
    const real = (name: string): string => join(repoRoot, "deploy", name);
    const ok = check(["--drill", real("compose.yaml"), real("compose.drill.yaml")]);
    expect(ok.err).toBe("");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("migrate");

    const live = readFileSync(real("compose.yaml"), "utf8");
    const noProfile = live.replace(/( {2}migrate:\n(?:.*\n)*?) {4}profiles: \[cli\]\n/, "$1");
    expect(noProfile).not.toBe(live);
    mkdirSync(join(dir, "copy", "deploy"), { recursive: true });
    writeFileSync(join(dir, "copy", "deploy", "compose.yaml"), noProfile);
    writeFileSync(join(dir, "copy", "deploy", "compose.drill.yaml"), readFileSync(real("compose.drill.yaml"), "utf8"));
    const bad = check([
      "--drill",
      join(dir, "copy", "deploy", "compose.yaml"),
      join(dir, "copy", "deploy", "compose.drill.yaml"),
    ]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("migrate must have profiles [cli]");
  });

  test("--drill without a file fails", () => {
    expect(check(["--drill"]).code).toBe(1);
  });
});

// Not --no-interpolate: it ignores profiles. The missing ${...:?} variables get dummy values. No daemon needed.
// The `server` service has `env_file: ../.env`. The CI checkout has no .env, and the Compose of the runner checks that this file
// exists even with --no-env-resolution. So the file goes to a throwaway project folder with an empty .env, and the repo stays clean.
const project = mkdtempSync(join(tmpdir(), "f103-s18-"));
mkdirSync(join(project, "deploy"));
writeFileSync(join(project, ".env"), "");
writeFileSync(join(project, "deploy", "compose.yaml"), readFileSync(join(repoRoot, "deploy", "compose.yaml")));
afterAll(() => rmSync(project, { recursive: true, force: true }));

// Fails loud: a Compose error stops the test with its stderr text, never an empty stdout that JSON.parse reads.
const composeConfig = (profile: string | null) => {
  const result = Bun.spawnSync(
    [
      "docker",
      "compose",
      "-f",
      join(project, "deploy", "compose.yaml"),
      ...(profile === null ? [] : ["--profile", profile]),
      "config",
      "--no-env-resolution",
      "--format",
      "json",
    ],
    { cwd: project, env: { ...process.env, APP_PASSWORD: "x", MIGRATOR_PASSWORD: "x", POSTGRES_PASSWORD: "x" } }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `docker compose config (profile ${profile ?? "none"}) exited ${result.exitCode}: ${result.stderr.toString()}`
    );
  }
  return {
    exitCode: result.exitCode,
    services: (JSON.parse(result.stdout.toString()) as { services: Record<string, unknown> }).services,
  };
};

interface OpsService {
  command?: string[];
  mem_limit?: string;
  ports?: { host_ip?: string; target?: number; published?: string }[];
  volumes?: Record<string, unknown>[];
  network_mode?: string | null;
  networks?: Record<string, unknown> | null;
  logging?: { driver: string };
  profiles?: string[];
}

describe("deploy/compose.yaml profile ops (the log store)", () => {
  const withOps = composeConfig("ops");
  const services = withOps.services as Record<string, OpsService>;
  const store = services.victorialogs;
  const agent = services.vlagent;

  test("victorialogs keeps 30 days and 1 GiB, 256 MB, and listens on loopback only", () => {
    expect(withOps.exitCode).toBe(0);
    expect(store?.command).toContain("-retentionPeriod=30d");
    expect(store?.command).toContain("-retention.maxDiskSpaceUsageBytes=1GiB");
    expect(store?.mem_limit).toBe("268435456");
    expect(store?.ports).toHaveLength(1);
    expect(store?.ports?.[0]?.host_ip).toBe("127.0.0.1");
    expect(store?.ports?.[0]?.target).toBe(9428);
    expect(store?.logging?.driver).toBe("local");
  });

  test("vlagent reads the Docker logs read-only, has no ports and 64 MB", () => {
    expect(agent?.mem_limit).toBe("67108864");
    expect(agent?.ports).toBeUndefined();
    // Only the container logs (read-only) and its own volume: no Docker socket, no other host path.
    // Compare only these fields: Compose versions differ in default bind/volume options.
    const volumes = (agent?.volumes ?? []).map(({ type, source, target, read_only }) => ({
      type,
      source,
      target,
      read_only: read_only ?? false,
    }));
    expect(volumes).toEqual([
      {
        type: "bind",
        source: "/var/lib/docker/containers",
        target: "/var/lib/docker/containers",
        read_only: true,
      },
      { type: "volume", source: "vlagent-data", target: "/vlagent", read_only: false },
    ]);
    expect(agent?.command).toContain("-fileCollector.glob=/var/lib/docker/containers/*/*-json.log");
    expect(agent?.logging?.driver).toBe("local");
  });

  test("vlagent sends to victorialogs only and caps its disk buffer", () => {
    const urls = agent?.command?.filter((a) => a.startsWith("-remoteWrite.url=")) ?? [];
    expect(urls).toEqual(["-remoteWrite.url=http://victorialogs:9428/internal/insert"]);
    expect(agent?.command).toContain("-remoteWrite.maxDiskUsagePerURL=500MB");
  });

  test("neither service sets network_mode or joins a network but the default one", () => {
    for (const service of [store, agent]) {
      expect(service?.network_mode ?? null).toBeNull();
      expect(Object.keys(service?.networks ?? {})).toEqual(["default"]);
    }
  });

  test("both services are behind the profile", () => {
    expect(store?.profiles).toEqual(["ops"]);
    expect(agent?.profiles).toEqual(["ops"]);
  });

  test("without the profile the config lists neither service", () => {
    const plain = composeConfig(null);
    expect(plain.exitCode).toBe(0);
    const names = Object.keys(plain.services);
    expect(names).not.toContain("victorialogs");
    expect(names).not.toContain("vlagent");
    expect(names).toContain("server");
  });
});

describe("deploy/compose.yaml drivers and the cli service", () => {
  const result = composeConfig("cli");
  interface Service {
    logging?: { driver: string; options: Record<string, string> };
    environment?: Record<string, string>;
    restart?: string;
    healthcheck?: { disable?: boolean };
    profiles?: string[];
  }
  const services = result.services as Record<string, Service>;

  test("server writes json-file, db and cli write local, all 10m x 5", () => {
    expect(result.exitCode).toBe(0);
    expect(services.server?.logging).toEqual({ driver: "json-file", options: { "max-size": "10m", "max-file": "5" } });
    expect(services.db?.logging).toEqual({ driver: "local", options: { "max-size": "10m", "max-file": "5" } });
    expect(services.cli?.logging).toEqual({ driver: "local", options: { "max-size": "10m", "max-file": "5" } });
  });

  test("cli prints text, never restarts and has no healthcheck", () => {
    expect(services.cli?.environment?.LOG_FORMAT).toBe("text");
    expect(services.server?.environment?.LOG_FORMAT).toBe("json");
    expect(services.cli?.restart).toBe("no");
    expect(services.cli?.healthcheck?.disable).toBe(true);
    expect(services.cli?.profiles).toEqual(["cli"]);
    expect(services.server?.profiles).toBeUndefined();
  });
});

// The migrate one-off service alone holds the migrator URL in its own env (the server keeps it until
// the contract release). The password comes from the interpolation file, planted with a sentinel.
describe("deploy/compose.yaml service migrate", () => {
  writeFileSync(
    join(project, "deploy", "db.env"),
    "POSTGRES_PASSWORD=sentinel-p-61\nMIGRATOR_PASSWORD=sentinel-m-61\nAPP_PASSWORD=sentinel-a-61\n"
  );
  const run = Bun.spawnSync(
    [
      "docker",
      "compose",
      "-f",
      "deploy/compose.yaml",
      "--env-file",
      "deploy/db.env",
      "--profile",
      "cli",
      "config",
      "--no-env-resolution",
      "--format",
      "json",
    ],
    { cwd: project, env: { PATH: process.env.PATH ?? "", HOME: project } }
  );
  if (run.exitCode !== 0) throw new Error(`docker compose config exited ${run.exitCode}: ${run.stderr.toString()}`);
  const services = (JSON.parse(run.stdout.toString()) as { services: Record<string, Record<string, unknown>> })
    .services;

  test("6. migrate has exactly the migrator URL and LOG_FORMAT, no env_file, ports or volumes, and the profile cli", () => {
    const migrate = services.migrate ?? {};
    expect(Object.keys((migrate.environment ?? {}) as object).sort()).toEqual(["LOG_FORMAT", "MIGRATOR_DATABASE_URL"]);
    const url = new URL(((migrate.environment ?? {}) as Record<string, string>).MIGRATOR_DATABASE_URL ?? "");
    expect(url.username).toBe("migrator");
    expect(url.password).toBe("sentinel-m-61");
    expect(migrate.env_file).toBeUndefined();
    expect(migrate.ports).toBeUndefined();
    expect(migrate.volumes).toBeUndefined();
    expect(migrate.profiles).toEqual(["cli"]);
    expect(migrate.command).toEqual(["bun", "run", "db:migrate"]);
  });

  test("7. server still carries the migrator URL (expand; the contract stage flips this test)", () => {
    const env = (services.server?.environment ?? {}) as Record<string, string>;
    expect(new URL(env.MIGRATOR_DATABASE_URL ?? "").username).toBe("migrator");
  });
});

describe("deploy/check-logging.sh rules for the log store services", () => {
  const base = readFileSync(join(repoRoot, "deploy", "compose.yaml"), "utf8");
  const mutated = (name: string, from: string, to: string): string => {
    expect(base).toContain(from);
    // Relative paths (env_file, build context) must still resolve: write next to the real file.
    const path = join(repoRoot, "deploy", `compose.${name}.tmp.yaml`);
    writeFileSync(path, base.replace(from, to));
    tmpFiles.push(path);
    return path;
  };
  const tmpFiles: string[] = [];
  afterAll(() => {
    for (const f of tmpFiles) rmSync(f, { force: true });
  });
  const env = { APP_PASSWORD: "x", MIGRATOR_PASSWORD: "x", POSTGRES_PASSWORD: "x" };

  test("fails on a Docker socket mount, an external remoteWrite URL and network_mode host", () => {
    const socket = check(
      [
        mutated(
          "socket",
          "      - vlagent-data:/vlagent\n",
          "      - vlagent-data:/vlagent\n      - /var/run/docker.sock:/var/run/docker.sock\n"
        ),
      ],
      env
    );
    expect(socket.code).toBe(1);
    expect(socket.err).toContain("vlagent volumes must be the read-only container-log mount");
    const url = check(
      [mutated("url", "http://victorialogs:9428/internal/insert", "https://logs.example.test/insert")],
      env
    );
    expect(url.code).toBe(1);
    expect(url.err).toContain("vlagent must send only to http://victorialogs:9428/");
    const host = check([mutated("host", "    mem_limit: 64m\n", "    mem_limit: 64m\n    network_mode: host\n")], env);
    expect(host.code).toBe(1);
    expect(host.err).toContain("vlagent must not set network_mode");
  });

  test("fails on a writable container-log mount", () => {
    const rw = check(
      [
        mutated(
          "rw",
          "/var/lib/docker/containers:/var/lib/docker/containers:ro",
          "/var/lib/docker/containers:/var/lib/docker/containers"
        ),
      ],
      env
    );
    expect(rw.code).toBe(1);
    expect(rw.err).toContain("vlagent volumes must be the read-only container-log mount");
  });
});
