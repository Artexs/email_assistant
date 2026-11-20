import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// F108 stage 02, tests 1–10: `deploy/env-split.sh` moves the database keys from .env to deploy/db.env and loses no value.
// Each case runs the script in a temp repo root with its own .env; stub commands sit first on PATH. No secret is real.

const DEPLOY = join(import.meta.dir, "..");
const SENTINELS = ["sentinel-p-71", "sentinel-m-71", "sentinel-u-71", "sentinel-a-71"];
const FIXTURE = [
  "A=1",
  "POSTGRES_PASSWORD=sentinel-p-71",
  "B=x=y # z",
  "MIGRATOR_PASSWORD=sentinel-m-71",
  "MIGRATOR_DATABASE_URL=postgres://migrator:sentinel-u-71@127.0.0.1:5433/x",
  "APP_PASSWORD=sentinel-a-71",
  "C=3",
];
const AFTER_ENV = ["A=1", "B=x=y # z", "C=3"];
const D5_LINES = FIXTURE.filter((line) =>
  /^(POSTGRES_PASSWORD|MIGRATOR_PASSWORD|MIGRATOR_DATABASE_URL|APP_PASSWORD)=/.test(line)
);

let root: string;
let stubs: string;
let seen: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "env-split-test-"));
  stubs = join(root, "stubs");
  mkdirSync(join(root, "deploy"));
  mkdirSync(stubs);
  copyFileSync(join(DEPLOY, "env-split.sh"), join(root, "deploy", "env-split.sh"));
  copyFileSync(join(DEPLOY, "compose-lib.sh"), join(root, "deploy", "compose-lib.sh"));
  seen = "";
});
afterEach(() => {
  // test 3, for every case: no sentinel in any output
  for (const sentinel of SENTINELS) expect(seen).not.toContain(sentinel);
  rmSync(root, { recursive: true, force: true });
});

const write = (name: string, lines: string[]): void => writeFileSync(join(root, name), `${lines.join("\n")}\n`);
const read = (name: string): string => readFileSync(join(root, name), "utf8");
const lines = (name: string): string[] => read(name).trimEnd().split("\n");

function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bash", join(root, "deploy", "env-split.sh"), ...args], {
    cwd: root,
    env: { PATH: `${stubs}:${process.env.PATH ?? ""}`, HOME: root },
  });
  const out = { code: result.exitCode ?? -1, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  seen += `${out.stdout}${out.stderr}`;
  return out;
}

function state(): string {
  const result = Bun.spawnSync(
    ["bash", "-c", `source "${join(root, "deploy", "compose-lib.sh")}"; ea_env_split_state`],
    { cwd: root }
  );
  return result.stdout.toString().trim();
}

const lastLine = (text: string): string => text.trimEnd().split("\n").at(-1) ?? "";
const leftovers = (): string[] =>
  [...readdirSync(root), ...readdirSync(join(root, "deploy"))].filter(
    (name) => name.includes(".bak") || name.includes("split-")
  );

describe("deploy/env-split.sh", () => {
  test("1. a split keeps the other lines in order, writes db.env with mode 600 and ends with moved=4", () => {
    write(".env", FIXTURE);
    const result = run();
    expect(result.code).toBe(0);
    expect(lastLine(result.stdout)).toBe("env split ok moved=4");
    expect(lines(".env")).toEqual(AFTER_ENV);
    expect(lines("deploy/db.env")).toEqual(D5_LINES);
    expect((statSync(join(root, "deploy", "db.env")).mode & 0o777).toString(8)).toBe("600");
    expect(state()).toBe("split");
    expect(leftovers()).toEqual([]);
  });

  test("2. the fixture without MIGRATOR_DATABASE_URL moves 3 lines", () => {
    write(
      ".env",
      FIXTURE.filter((line) => !line.startsWith("MIGRATOR_DATABASE_URL="))
    );
    const result = run();
    expect(result.code).toBe(0);
    expect(lastLine(result.stdout)).toBe("env split ok moved=3");
    expect(lines("deploy/db.env")).toHaveLength(3);
  });

  test("4. a second run says already split, exits 0 and writes nothing", () => {
    write(".env", FIXTURE);
    run();
    const [env, db] = [read(".env"), read("deploy/db.env")];
    const result = run();
    expect(result.code).toBe(0);
    expect(lastLine(result.stdout)).toBe("env split: already split");
    expect([read(".env"), read("deploy/db.env")]).toEqual([env, db]);
  });

  test("5. a half-done split (db.env written, .env untouched) is finished", () => {
    write(".env", FIXTURE);
    run();
    const [env, db] = [read(".env"), read("deploy/db.env")];
    write(".env", FIXTURE);
    const result = run();
    expect(result.code).toBe(0);
    expect(lastLine(result.stdout)).toBe("env split ok finished=4");
    expect([read(".env"), read("deploy/db.env")]).toEqual([env, db]);
  });

  test("6. a mixed state with a different value is refused, names the key and changes no file", () => {
    write("deploy/db.env", ["APP_PASSWORD=other"]);
    write(".env", ["A=1", "APP_PASSWORD=sentinel-a-71"]);
    const [env, db] = [read(".env"), read("deploy/db.env")];
    const result = run();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("APP_PASSWORD");
    expect([read(".env"), read("deploy/db.env")]).toEqual([env, db]);
    expect(leftovers()).toEqual([]);
  });

  test("7. a .env without MIGRATOR_PASSWORD and no db.env is refused and writes nothing", () => {
    write(
      ".env",
      FIXTURE.filter((line) => !line.startsWith("MIGRATOR_PASSWORD="))
    );
    const before = read(".env");
    const result = run();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("MIGRATOR_PASSWORD");
    expect(existsSync(join(root, "deploy", "db.env"))).toBe(false);
    expect(read(".env")).toBe(before);
  });

  test("8. a key twice in .env is refused and writes nothing", () => {
    write(".env", [...FIXTURE, "APP_PASSWORD=sentinel-a-71"]);
    const before = read(".env");
    const result = run();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("APP_PASSWORD");
    expect(existsSync(join(root, "deploy", "db.env"))).toBe(false);
    expect(read(".env")).toBe(before);
    expect(leftovers()).toEqual([]);
  });

  test("9. --undo puts the seven lines back, removes db.env and a second --undo is refused", () => {
    write(".env", FIXTURE);
    run();
    const result = run("--undo");
    expect(result.code).toBe(0);
    expect(lastLine(result.stdout)).toBe("env split undone moved=4");
    expect([...lines(".env")].sort()).toEqual([...FIXTURE].sort());
    expect(existsSync(join(root, "deploy", "db.env"))).toBe(false);
    expect(state()).toBe("old");
    const again = run("--undo");
    expect(again.code).toBe(2);
  });

  test("10. a failing second mv leaves .env as it was, no temp or .bak file, and a rerun finishes the split", () => {
    // `mv` counts its calls in a file and fails on the second: db.env is renamed, the .env rename fails.
    const counter = join(root, "mv.calls");
    const body = `echo x >>"${counter}"\n[[ "$(wc -l <"${counter}")" -ge 2 ]] && exit 1\nexec /usr/bin/env mv "$@"`;
    const file = join(stubs, "mv");
    writeFileSync(file, `#!/usr/bin/env bash\nPATH="\${PATH#${stubs}:}"\n${body}\n`);
    chmodSync(file, 0o755);
    write(".env", FIXTURE);
    const before = read(".env");
    const result = run();
    expect(result.code).not.toBe(0);
    expect(read(".env")).toBe(before);
    expect(leftovers()).toEqual([]);
    rmSync(file);
    const rerun = run();
    expect(rerun.code).toBe(0);
    expect(lastLine(rerun.stdout)).toBe("env split ok finished=4");
    expect(lines(".env")).toEqual(AFTER_ENV);
  });
});
