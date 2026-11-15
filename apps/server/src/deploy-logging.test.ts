import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

// F103 stage 17: deploy/check-logging.sh wants `server` on json-file (the files the log store reads), every other service on
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

  test("passes when documents use cli, or exec in server", () => {
    const docs = write("good.md", "$C run --rm cli bun run x\n$C exec server bun run x\nthe server runs a job\n");
    const result = check([passing()], { CHECK_LOGGING_DOCS: docs });
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
  });
});

describe("deploy/compose.yaml drivers and the cli service", () => {
  // Not --no-interpolate: it ignores profiles. The missing ${...:?} variables get dummy values. No daemon needed.
  const result = Bun.spawnSync(
    [
      "docker",
      "compose",
      "-f",
      "deploy/compose.yaml",
      "--profile",
      "cli",
      "config",
      "--no-env-resolution",
      "--format",
      "json",
    ],
    { cwd: repoRoot, env: { ...process.env, APP_PASSWORD: "x", MIGRATOR_PASSWORD: "x", POSTGRES_PASSWORD: "x" } }
  );
  interface Service {
    logging?: { driver: string; options: Record<string, string> };
    environment?: Record<string, string>;
    restart?: string;
    healthcheck?: { disable?: boolean };
  }
  const services = (JSON.parse(result.stdout.toString()) as { services: Record<string, Service> }).services;

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
  });
});
