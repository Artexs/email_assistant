import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Stage 01 of the production-on-the-VPS ticket, tests 1–4: `deploy/compose-lib.sh` builds the Compose command and names the state of the env split.
// Each case runs bash in a temp repo root that holds the files of the case.

const LIB = join(import.meta.dir, "..", "compose-lib.sh");
const PASSWORDS = ["POSTGRES_PASSWORD=p", "MIGRATOR_PASSWORD=m", "APP_PASSWORD=a"];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "compose-lib-test-"));
  mkdirSync(join(root, "deploy"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const file = (name: string, lines: string[]): void => writeFileSync(join(root, name), `${lines.join("\n")}\n`);

function bash(script: string): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bash", "-c", `source "${LIB}"; ${script}`], { cwd: root });
  return { code: result.exitCode ?? -1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const state = (): string => bash("ea_env_split_state").stdout.trim();

describe("ea_compose_init", () => {
  test("1. .env only: the command ends with --env-file .env", () => {
    file(".env", ["A=1"]);
    const result = bash('ea_compose_init && echo "${EA_COMPOSE[*]}"');
    expect(result.stdout.trim()).toBe("docker compose -f deploy/compose.yaml --env-file .env");
  });

  test("2. .env and deploy/db.env: the command ends with --env-file deploy/db.env", () => {
    file(".env", ["A=1"]);
    file("deploy/db.env", PASSWORDS);
    const result = bash('ea_compose_init && echo "${EA_COMPOSE[*]}"');
    expect(result.stdout.trim()).toBe("docker compose -f deploy/compose.yaml --env-file deploy/db.env");
    expect(bash('ea_compose_init && echo "${EA_COMPOSE_FILES[*]}"').stdout.trim()).toBe(
      "-f deploy/compose.yaml --env-file deploy/db.env"
    );
  });

  test("3. neither file: return 2 and the message on stderr", () => {
    const result = bash("ea_compose_init");
    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toBe("compose: no deploy/db.env and no .env");
  });
});

describe("ea_env_split_state", () => {
  test.each([
    ["4a. db.env and a .env without D5 keys: split", ["A=1"], "split"],
    ["4c. db.env and a .env with APP_PASSWORD=: mixed", ["APP_PASSWORD="], "mixed"],
    ["4d. db.env and a .env with only MIGRATOR_DATABASE_URL=: mixed", ["MIGRATOR_DATABASE_URL="], "mixed"],
  ])("%s", (_name, envLines, expected) => {
    file("deploy/db.env", PASSWORDS);
    file(".env", envLines);
    expect(state()).toBe(expected);
  });

  test("4b. no db.env and a .env with the three passwords, with or without the migrator URL: old", () => {
    file(".env", [...PASSWORDS, "A=1"]);
    expect(state()).toBe("old");
    file(".env", [...PASSWORDS, "MIGRATOR_DATABASE_URL=postgres://x"]);
    expect(state()).toBe("old");
  });

  test("4e. no db.env and a .env with two of the three passwords: mixed", () => {
    file(".env", PASSWORDS.slice(0, 2));
    expect(state()).toBe("mixed");
  });

  test("4f. a comment line and a longer key name do not count", () => {
    file("deploy/db.env", PASSWORDS);
    file(".env", ["# POSTGRES_PASSWORD=x", "XPOSTGRES_PASSWORD=x", "A=1"]);
    expect(state()).toBe("split");
    rmSync(join(root, "deploy", "db.env"));
    file(".env", ["# POSTGRES_PASSWORD=x", "XPOSTGRES_PASSWORD=x", "MIGRATOR_PASSWORD=m", "APP_PASSWORD=a"]);
    expect(state()).toBe("mixed");
  });

  test("EA_D5_KEYS lists the four keys", () => {
    expect(bash('echo "${EA_D5_KEYS[*]}"').stdout.trim()).toBe(
      "POSTGRES_PASSWORD MIGRATOR_PASSWORD APP_PASSWORD MIGRATOR_DATABASE_URL"
    );
  });
});
