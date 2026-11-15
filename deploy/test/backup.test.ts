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

// F114 stage 04: `deploy/backup.sh` writes `deploy/backup-status/status.json` and pings Healthchecks.io. The script runs in a
// temp copy of the repo layout with stub commands (`docker`, `age`, `rclone`, `curl`) first on PATH. No real Docker, no real
// network, no real data.

const SCRIPT = join(import.meta.dir, "..", "backup.sh");
const PING_URL = "https://hc.invalid/ping/00000000-secret-0000";

let root: string;
let stubs: string;
let backups: string;

function stub(name: string, body: string): void {
  const file = join(stubs, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

function writeEnv(extra: string): void {
  writeFileSync(
    join(root, "deploy", "backup.env"),
    `BACKUP_DIR=${backups}\nAGE_RECIPIENT=age1testkey\nBACKUP_REMOTE=stub:bucket/x\n${extra}\n`
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "backup-test-"));
  stubs = join(root, "stubs");
  backups = join(root, "backups");
  mkdirSync(join(root, "deploy", "backup-status"), { recursive: true });
  mkdirSync(stubs);
  copyFileSync(SCRIPT, join(root, "deploy", "backup.sh"));
  writeFileSync(join(root, ".env"), "");
  // `docker compose ... exec -T db pg_dump ...`: print the magic and some bytes
  stub("docker", `printf 'PGDMPfake-dump-body'`);
  // `age -r <recipient> -o <file>`: copy stdin to the file
  stub("age", `while [[ $# -gt 0 ]]; do [[ "$1" == -o ]] && out="$2"; shift; done\ncat >"$out"`);
  // `rclone copyto <src> <dest>`: fail when asked
  stub("rclone", `[[ -n "\${STUB_RCLONE_FAIL:-}" ]] && exit 1\nexit 0`);
  // `curl`: log the arguments, one call per line; fail when asked, and print the URL on stderr as a leaky curl would
  stub(
    "curl",
    `echo "$*" >>"${root}/curl.log"\nif [[ -n "\${STUB_CURL_FAIL:-}" ]]; then echo "curl: (7) could not reach \${@: -1}" >&2; exit 7; fi\nexit 0`
  );
  writeEnv(`BACKUP_PING_URL=${PING_URL}`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(extraEnv: Record<string, string> = {}): { code: number; stdout: string; output: string } {
  const result = Bun.spawnSync(["bash", join(root, "deploy", "backup.sh")], {
    cwd: root,
    env: { PATH: `${stubs}:${process.env.PATH ?? ""}`, HOME: root, ...extraEnv },
  });
  const stdout = result.stdout.toString();
  return { code: result.exitCode ?? -1, stdout, output: `${stdout}${result.stderr.toString()}` };
}

function status(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, "deploy", "backup-status", "status.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function curlCalls(): string[] {
  const file = join(root, "curl.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

describe("deploy/backup.sh status file and ping", () => {
  test("1. a good run writes ok, the size, last_ok_at = at, and pings the URL once", () => {
    const { code, stdout } = run();
    expect(code).toBe(0);
    const last = stdout.trim().split("\n").at(-1) ?? "";
    const [word, ok, name, bytes] = last.split(" ");
    expect([word, ok]).toEqual(["backup", "ok"]);
    expect(name).toMatch(/^ea-\d{8}T\d{6}Z\.dump\.age$/);
    const written = status();
    expect(written.result).toBe("ok");
    expect(written.name).toBe(name);
    expect(written.bytes).toBe(statSync(join(backups, name ?? "")).size);
    expect(String(written.bytes)).toBe(bytes);
    expect(written.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(written.last_ok_at).toBe(written.at);
    const calls = curlCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(PING_URL);
    expect(calls[0]).not.toContain("/fail");
  });

  test("2. a failed copy writes failed, keeps the old last_ok_at, pings /fail and leaves no dump", () => {
    const first = run();
    expect(first.code).toBe(0);
    const lastOk = status().last_ok_at;
    expect(typeof lastOk).toBe("string");
    for (const file of readdirSync(backups)) rmSync(join(backups, file));
    rmSync(join(root, "curl.log"));

    const second = run({ STUB_RCLONE_FAIL: "1" });
    expect(second.code).not.toBe(0);
    const written = status();
    expect(written.result).toBe("failed");
    expect(written.name).toBeNull();
    expect(written.bytes).toBeNull();
    expect(written.last_ok_at).toBe(lastOk);
    expect(curlCalls()).toEqual([expect.stringContaining(`${PING_URL}/fail`)]);
    expect(readdirSync(backups).filter((file) => file.includes(".dump.age") || file.endsWith(".part"))).toEqual([]);
  });

  test("2b. a first run that fails has last_ok_at null; a bad backup.env also writes failed", () => {
    expect(run({ STUB_RCLONE_FAIL: "1" }).code).not.toBe(0);
    expect(status().last_ok_at).toBeNull();
    writeFileSync(
      join(root, "deploy", "backup.env"),
      `BACKUP_DIR=relative/path\nAGE_RECIPIENT=age1x\nBACKUP_REMOTE=r:b\n`
    );
    expect(run().code).not.toBe(0);
    expect(status().result).toBe("failed");
    rmSync(join(root, "deploy", "backup.env"));
    expect(run().code).not.toBe(0);
    expect(status().result).toBe("failed");
  });

  test("3. a failed ping keeps exit 0, prints backup ping failed and never the URL", () => {
    const { code, output } = run({ STUB_CURL_FAIL: "1" });
    expect(code).toBe(0);
    expect(output).toContain("backup ping failed");
    expect(output).not.toContain(PING_URL);
    expect(output).not.toContain("secret");
    expect(status().result).toBe("ok");
  });

  test("4. an empty BACKUP_PING_URL never calls curl", () => {
    writeEnv("BACKUP_PING_URL=");
    expect(run().code).toBe(0);
    expect(curlCalls()).toEqual([]);
    writeEnv("");
    expect(run({ STUB_RCLONE_FAIL: "1" }).code).not.toBe(0);
    expect(curlCalls()).toEqual([]);
  });

  test("5. the file has mode 644 and no .tmp file stays", () => {
    run();
    run({ STUB_RCLONE_FAIL: "1" });
    const dir = join(root, "deploy", "backup-status");
    expect(statSync(join(dir, "status.json")).mode & 0o777).toBe(0o644);
    expect(readdirSync(dir).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });
});
