import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// F108 stage 02, tests 11–15: `deploy/check-server-env.sh` reads the key names of the running server's env and refuses the database keys.
// A stub `docker` first on PATH prints the env list (or fails) and records its argv. No real Docker.

const DEPLOY = join(import.meta.dir, "..");
const SENTINELS = ["sentinel-u-72", "sentinel-a-72", "sentinel-d-72"];
const CLEAN = ["PATH=/usr/bin", "NODE_ENV=production", "PORT=8080", "LOG_FORMAT=json", "TZ=UTC"];

let root: string;
let stubs: string;
let seen: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-server-env-test-"));
  stubs = join(root, "stubs");
  mkdirSync(join(root, "deploy"));
  mkdirSync(stubs);
  copyFileSync(join(DEPLOY, "check-server-env.sh"), join(root, "deploy", "check-server-env.sh"));
  copyFileSync(join(DEPLOY, "compose-lib.sh"), join(root, "deploy", "compose-lib.sh"));
  writeFileSync(join(root, ".env"), "A=1\n");
  seen = "";
});
afterEach(() => {
  for (const sentinel of SENTINELS) expect(seen).not.toContain(sentinel);
  rmSync(root, { recursive: true, force: true });
});

function stubDocker(envLines: string[], exitCode = 0): void {
  const file = join(stubs, "docker");
  writeFileSync(
    file,
    `#!/usr/bin/env bash\necho "$*" >>"${root}/docker.argv"\ncat <<'LIST'\n${envLines.join("\n")}\nLIST\nexit ${exitCode}\n`
  );
  chmodSync(file, 0o755);
}

function run(): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bash", join(root, "deploy", "check-server-env.sh")], {
    cwd: root,
    env: { PATH: `${stubs}:${process.env.PATH ?? ""}`, HOME: root },
  });
  const out = { code: result.exitCode ?? -1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  seen += `${out.stdout}${out.stderr}`;
  return out;
}

describe("deploy/check-server-env.sh", () => {
  test("11. a list without database keys is ok and counts the keys", () => {
    stubDocker(CLEAN);
    const result = run();
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("server env ok keys=5");
  });

  test("12. the migrator URL and APP_PASSWORD are named, sorted, on stderr, and exit is 1", () => {
    stubDocker([
      ...CLEAN,
      "MIGRATOR_DATABASE_URL=postgres://migrator:sentinel-u-72@db/x",
      "APP_PASSWORD=sentinel-a-72",
    ]);
    const result = run();
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe("server env bad: APP_PASSWORD,MIGRATOR_DATABASE_URL");
    expect(result.stdout).toBe("");
  });

  test("13. DATABASE_URL alone is not a database admin key", () => {
    stubDocker([...CLEAN, "DATABASE_URL=postgres://app:sentinel-d-72@db/x"]);
    const result = run();
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("server env ok keys=6");
  });

  test("14. a failing docker exits 2", () => {
    stubDocker([], 1);
    const result = run();
    expect(result.code).toBe(2);
  });

  test("15. docker gets `exec -T server env` and the env file the helper chose", () => {
    stubDocker(CLEAN);
    run();
    expect(readFileSync(join(root, "docker.argv"), "utf8").trim()).toBe(
      "compose -f deploy/compose.yaml --env-file .env exec -T server env"
    );
    writeFileSync(join(root, "deploy", "db.env"), "POSTGRES_PASSWORD=x\n");
    rmSync(join(root, "docker.argv"));
    run();
    expect(readFileSync(join(root, "docker.argv"), "utf8").trim()).toBe(
      "compose -f deploy/compose.yaml --env-file deploy/db.env exec -T server env"
    );
  });

  test("a value that holds a key-like text on a later line does not count as a key", () => {
    stubDocker([...CLEAN, "NOTE=first line", "  APP_PASSWORD=inside-a-value"]);
    expect(run().code).toBe(0);
  });

  test("no env file at all exits 2", () => {
    stubDocker(CLEAN);
    rmSync(join(root, ".env"));
    expect(run().code).toBe(2);
    expect(existsSync(join(root, "docker.argv"))).toBe(false);
  });

  test("N4. an empty env list is a failure (exit 2), not ok keys=0", () => {
    stubDocker([]);
    const result = run();
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no keys");
  });
});
