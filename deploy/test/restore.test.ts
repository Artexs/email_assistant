import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { credentialsLine } from "../../apps/server/src/scripts/lib/credentials-check-lines";

// F114 stage 07: `deploy/restore.sh` in a temp copy of the repo layout, with recording stubs (`docker`, `age`, `openssl`) first
// on PATH. No real Docker, no real data. The `docker` stub records one line per call, with the number of stdin bytes it read, so a
// test sees which call got the dump. Switches are files in `stubs/`:
//   tables         what the schema query returns (default 0)
//   creds-failed   the `failed=` value of `credentials:check` (default 0)
//   creds-line     the whole output of `credentials:check`, instead
//   config-json    what `docker compose config --format json` prints (default: project ea-drill, no port)
//   counts         the rows the count query prints (default: organizations 2, users 3, mailboxes 1, emails 40)
//   docker-fail    a substring of an argument list that makes `docker` exit 1
//   init-probes    N: the first N TCP probes (`pg_isready -h 127.0.0.1`) fail; while N > 0 and the TCP probe has not passed, the
//                  `pg_tables` query prints "the database system is shutting down" and fails, and the socket probe passes
//                  (the init server of the Postgres image answers on the socket only). Default 0.
//   never-ready    every TCP probe fails
// A recording `sleep` stub (one `sleep <args>` line in calls.log) keeps the tests from waiting.

const DEPLOY = join(import.meta.dir, "..");
const DUMP = "PLAIN-DUMP-BYTES";
// What `bun run credentials:check` prints: the line of the real script (`credentials-check-lines.ts`) after the prefix of createCliOutput
// (`[credentials-check] `, as `apps/server/src/platform/cli.ts` writes it). The stub fills in `failed` from the switch.
const CREDS_FAILED_MARK = "99999";
const CREDS_LINE_TEMPLATE = `[credentials-check] ${credentialsLine({ ok: 4, failed: Number(CREDS_FAILED_MARK) })}`;
const DRILL_CONFIG_OK = JSON.stringify({ name: "ea-drill", services: { db: {}, server: {} } });

let root: string;
let stubs: string;

interface Run {
  code: number;
  stdout: string;
  output: string;
}

function stub(name: string, body: string): void {
  const file = join(stubs, name);
  writeFileSync(file, `#!/usr/bin/env bash\nS="${stubs}"\nCALLS="${root}/calls.log"\n${body}\n`);
  chmodSync(file, 0o755);
}

function setSwitch(name: string, content: string): void {
  writeFileSync(join(stubs, name), content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "restore-test-"));
  stubs = join(root, "stubs");
  mkdirSync(stubs);
  mkdirSync(join(root, "deploy"));
  copyFileSync(join(DEPLOY, "restore.sh"), join(root, "deploy", "restore.sh"));
  chmodSync(join(root, "deploy", "restore.sh"), 0o755);
  copyFileSync(join(DEPLOY, "compose-lib.sh"), join(root, "deploy", "compose-lib.sh"));
  writeFileSync(join(root, ".env"), "POSTGRES_PASSWORD=live-pg\n");
  writeFileSync(join(root, "age-identity.txt"), "AGE-SECRET-KEY-TEST\n");
  writeFileSync(join(root, "backup.dump.age"), "ciphertext\n");

  stub(
    "docker",
    `# pg_restore reads the dump (and no more); every other call reads whatever is left on stdin, so a call without </dev/null shows.
if [[ "$*" == *pg_restore* ]]; then bytes="$(head -c ${DUMP.length} | wc -c)"; else bytes="$(cat | wc -c)"; fi
args="$*"; args="\${args//$'\\n'/ }"
echo "docker $args stdin=$bytes proj=\${COMPOSE_PROJECT_NAME:-} rel=\${EA_RELEASE:-}" >>"$CALLS"
if [[ -f "$S/docker-fail" && "$*" == *"$(cat "$S/docker-fail")"* ]]; then exit 1; fi
if [[ "$*" == *" config "* ]]; then
  if [[ -f "$S/config-json" ]]; then cat "$S/config-json"; else printf '%s' '${DRILL_CONFIG_OK}'; fi
  exit 0
fi
if [[ "$*" == *pg_isready* ]]; then
  if [[ "$*" != *"-h 127.0.0.1"* ]]; then exit 0; fi
  if [[ -f "$S/never-ready" ]]; then exit 2; fi
  n="$(cat "$S/probe-count" 2>/dev/null || echo 0)"; n=$((n + 1)); echo "$n" >"$S/probe-count"
  if (( n <= $(cat "$S/init-probes" 2>/dev/null || echo 0) )); then exit 2; fi
  echo ready >"$S/phase"
  exit 0
fi
if [[ "$*" == *"pg_tables"* ]]; then
  if (( $(cat "$S/init-probes" 2>/dev/null || echo 0) > 0 )) && [[ ! -f "$S/phase" ]]; then
    echo "psql: error: connection to server on socket failed: FATAL:  the database system is shutting down" >&2; exit 2
  fi
  cat "$S/tables" 2>/dev/null || echo 0; exit 0
fi
if [[ "$*" == *"from organizations"* ]]; then
  if [[ -f "$S/counts" ]]; then cat "$S/counts"; else printf 'organizations 2\\nusers 3\\nmailboxes 1\\nemails 40\\n'; fi
  exit 0
fi
if [[ "$*" == *"credentials:check"* ]]; then
  if [[ -f "$S/creds-line" ]]; then cat "$S/creds-line"; else failed="$(cat "$S/creds-failed" 2>/dev/null || echo 0)"; echo "${CREDS_LINE_TEMPLATE.replace(CREDS_FAILED_MARK, "$failed")}"; fi
  exit 0
fi
exit 0`
  );
  stub("sleep", `echo "sleep $*" >>"$CALLS"`);
  stub("age", `echo "age $*" >>"$CALLS"\nprintf '%s' '${DUMP}'`);
  stub(
    "openssl",
    `echo "openssl $*" >>"$CALLS"
n="$(cat "$S/openssl-count" 2>/dev/null || echo 0)"; n=$((n + 1)); echo "$n" >"$S/openssl-count"
echo "generated-secret-$n"`
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[], options: { stdin?: string; env?: Record<string, string> } = {}): Run {
  const result = Bun.spawnSync(["bash", join(root, "deploy", "restore.sh"), ...args], {
    cwd: root,
    // Bytes after the dump: a docker call that reads stdin and is not pg_restore eats them.
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(`${options.stdin}TRAILING-BYTES`),
    env: { PATH: `${stubs}:${process.env.PATH ?? ""}`, HOME: root, ...options.env },
  });
  const stdout = result.stdout.toString();
  return { code: result.exitCode ?? -1, stdout, output: `${stdout}${result.stderr.toString()}` };
}

const calls = (): string[] => {
  const file = join(root, "calls.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
};
const dockerCalls = (): string[] => calls().filter((line) => line.startsWith("docker "));
const indexOfCall = (lines: readonly string[], text: string, from = 0): number =>
  lines.findIndex((line, index) => index >= from && line.includes(text));
const PROBE = "pg_isready -q -h 127.0.0.1 -U postgres -d email_assistant";
const probeCalls = (): string[] => dockerCalls().filter((line) => line.includes(PROBE));
const sleepCalls = (): string[] => calls().filter((line) => line.startsWith("sleep "));
const writeDrillEnv = (): void => writeFileSync(join(root, "deploy", "drill.env"), "POSTGRES_PASSWORD=drill-pg\n");
const lastLine = (text: string): string => text.trim().split("\n").at(-1) ?? "";

describe("restore.sh refusals", () => {
  test("1. --target drill without deploy/drill.env exits 2 and calls no docker", () => {
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(2);
    expect(result.output).toContain("drill.env");
    expect(dockerCalls()).toEqual([]);
  });

  test("a bad target, a missing file, a missing mode and an unknown option exit 2 before any docker call", () => {
    writeDrillEnv();
    for (const args of [
      [],
      ["--target", "live", "--stdin"],
      ["--target", "drill"],
      ["--target", "drill", "--stdin", "extra"],
      ["--target", "drill", "nofile.dump.age", join(root, "age-identity.txt")],
      ["--target", "drill", join(root, "backup.dump.age"), "noidentity.txt"],
      ["--target", "drill", "--frobnicate"],
    ]) {
      expect(run(args, { stdin: DUMP }).code, args.join(" ")).toBe(2);
    }
    expect(dockerCalls()).toEqual([]);
  });

  test("new-host without .env exits 2", () => {
    rmSync(join(root, ".env"));
    expect(run(["--target", "new-host", "--stdin"], { stdin: DUMP }).code).toBe(2);
    expect(dockerCalls()).toEqual([]);
  });

  test("the drill refuses a resolved project named like the live one, and a service that publishes a port; no build follows", () => {
    writeDrillEnv();
    setSwitch("config-json", JSON.stringify({ name: "email-assistant", services: { db: {} } }));
    const live = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(live.code).toBe(2);
    expect(live.output).toContain("live project");
    setSwitch(
      "config-json",
      JSON.stringify({ name: "ea-drill", services: { server: { ports: [{ published: "8080" }] } } })
    );
    const published = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(published.code).toBe(2);
    expect(published.output).toContain("publishes a port");
    expect(dockerCalls().some((line) => line.includes(" build "))).toBe(false);
    // The config holds the drill passwords: the script never prints it.
    expect(live.output).not.toContain("services");
  });
});

describe("restore.sh --init-env", () => {
  const liveFile = (): string => {
    const file = join(root, "live.env");
    writeFileSync(
      file,
      [
        "TELEGRAM_BOT_TOKEN=t1",
        "POSTGRES_PASSWORD=live-pg",
        "CREDENTIALS_KEY=key-marker-q7z",
        "CREDENTIALS_KEY_VERSION=2",
        "GEMINI_API_KEY=g1",
        "HEARTBEAT_URL=https://hc.invalid/live-ping",
        "",
      ].join("\n")
    );
    return file;
  };

  test("2. drill.env holds the credentials key and three new passwords, mode 600, and the output prints none of them", () => {
    const result = run(["--target", "drill", "--init-env", liveFile()]);
    expect(result.code).toBe(0);
    const file = join(root, "deploy", "drill.env");
    const text = readFileSync(file, "utf8");
    expect(text).toContain("CREDENTIALS_KEY=key-marker-q7z\n");
    expect(text).toContain("CREDENTIALS_KEY_VERSION=2\n");
    expect(text).toContain("LOG_LEVEL=info\n");
    for (const forbidden of ["t1", "live-pg", "g1", "TELEGRAM", "HEARTBEAT", "GEMINI", "live-ping"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    const passwords = ["POSTGRES_PASSWORD", "MIGRATOR_PASSWORD", "APP_PASSWORD"].map((key) => {
      const match = new RegExp(`^${key}=(generated-secret-\\d+)$`, "m").exec(text);
      expect(match, key).not.toBeNull();
      return match?.[1];
    });
    expect(new Set(passwords).size).toBe(3);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(result.output).not.toContain("key-marker-q7z");
    expect(result.output).not.toContain("generated-secret");
    expect(calls().filter((line) => line.startsWith("openssl rand -hex 24"))).toHaveLength(3);
    expect(dockerCalls()).toEqual([]);
  });

  test("a live file without CREDENTIALS_KEY exits 2 and writes nothing; an existing drill.env is never overwritten", () => {
    const noKey = join(root, "nokey.env");
    writeFileSync(noKey, "CREDENTIALS_KEY_VERSION=1\nPOSTGRES_PASSWORD=x\n");
    expect(run(["--target", "drill", "--init-env", noKey]).code).toBe(2);
    expect(existsSync(join(root, "deploy", "drill.env"))).toBe(false);
    expect(run(["--target", "drill", "--init-env", join(root, "missing.env")]).code).toBe(2);

    writeDrillEnv();
    const again = run(["--target", "drill", "--init-env", liveFile()]);
    expect(again.code).toBe(2);
    expect(readFileSync(join(root, "deploy", "drill.env"), "utf8")).toBe("POSTGRES_PASSWORD=drill-pg\n");
  });

  test("--init-env with new-host exits 2", () => {
    expect(run(["--target", "new-host", "--init-env", liveFile()]).code).toBe(2);
  });
});

describe("restore.sh drill", () => {
  const DRILL_PREFIX =
    "docker compose -p ea-drill -f deploy/compose.yaml -f deploy/compose.drill.yaml --env-file deploy/drill.env";

  test("3. a drill restore from stdin runs the steps in order, always in project ea-drill, with one build", () => {
    writeDrillEnv();
    const result = run(["--target", "drill", "--stdin"], {
      stdin: DUMP,
      env: { COMPOSE_PROJECT_NAME: "email-assistant", COMPOSE_FILE: "x" },
    });
    expect(result.code).toBe(0);
    const lines = dockerCalls();
    for (const line of lines) {
      expect(line.startsWith(DRILL_PREFIX), line).toBe(true);
      // The caller's COMPOSE_PROJECT_NAME never reaches Compose.
      expect(line, line).toMatch(/ proj= rel=\S*$/);
    }
    const order = [
      " config ",
      " up -d --wait db",
      PROBE,
      "pg_tables",
      " build server",
      "pg_restore",
      "from organizations",
      "update mailboxes set status = 'paused'",
      "delete from ops_alerts",
      "delete from auth_sessions",
      "run --rm -T migrate",
      "run --rm -T cli bun run credentials:check",
      " up -d --no-build --wait",
    ];
    let from = 0;
    for (const text of order) {
      const index = indexOfCall(lines, text, from);
      expect(index, text).toBeGreaterThanOrEqual(from);
      from = index + 1;
    }
    expect(lines).toHaveLength(order.length);
    expect(lines.filter((line) => line.includes("--build"))).toHaveLength(0);
    expect(lines.filter((line) => / build /.test(line))).toHaveLength(1);
    expect(lines.find((line) => line.includes("pg_restore"))).toContain("--no-owner --role=migrator --exit-on-error");
    expect(result.stdout).toContain("count organizations=2 users=3 mailboxes=1 emails=40");
    expect(result.stdout).toContain("[credentials-check] credentials ok=4 failed=0");
    expect(lastLine(result.stdout)).toMatch(/^restore ok target=drill seconds=\d+$/);
    expect(result.stdout).not.toContain("deleted <org id>");
  });

  test("EA_RELEASE is the checked-out tag for the build, the migrate and the up, and dev when HEAD has no tag", () => {
    writeDrillEnv();
    const git = (...args: string[]): void => {
      const result = Bun.spawnSync(["git", "-c", "user.email=a@x.test", "-c", "user.name=a", ...args], { cwd: root });
      expect(result.exitCode, args.join(" ")).toBe(0);
    };
    git("init", "-q");
    git("add", "deploy/restore.sh");
    git("commit", "-q", "-m", "x");
    expect(run(["--target", "drill", "--stdin"], { stdin: DUMP }).code).toBe(0);
    const untagged = dockerCalls().filter((line) => / (build server|run --rm|up -d --no-build)/.test(line));
    expect(untagged).toHaveLength(4); // build, migrate, credentials, up
    for (const line of untagged) expect(line, line).toEndWith(" rel=dev");

    rmSync(join(root, "calls.log"));
    git("tag", "v0.1.0");
    expect(run(["--target", "drill", "--stdin"], { stdin: DUMP }).code).toBe(0);
    for (const line of dockerCalls().filter((line) => / (build server|run --rm|up -d --no-build)/.test(line))) {
      expect(line, line).toEndWith(" rel=v0.1.0");
    }
  });

  test("7. only the pg_restore call reads stdin; the dump reaches it whole", () => {
    writeDrillEnv();
    expect(run(["--target", "drill", "--stdin"], { stdin: DUMP }).code).toBe(0);
    const reading = dockerCalls().filter((line) => !/ stdin=0 proj= rel=\S*$/.test(line));
    expect(reading).toHaveLength(1);
    expect(reading[0]).toContain("pg_restore");
    expect(reading[0]).toContain(`stdin=${DUMP.length} `);
  });

  test("a file restore decrypts with age into the same pg_restore call", () => {
    writeDrillEnv();
    const result = run(["--target", "drill", join(root, "backup.dump.age"), join(root, "age-identity.txt")]);
    expect(result.code).toBe(0);
    expect(calls().filter((line) => line.startsWith("age "))).toEqual([
      `age -d -i ${join(root, "age-identity.txt")} ${join(root, "backup.dump.age")}`,
    ]);
    const restoreCall = dockerCalls().find((line) => line.includes("pg_restore"));
    expect(restoreCall).toContain(`stdin=${DUMP.length} `);
    expect(dockerCalls().filter((line) => !/ stdin=0 proj= rel=\S*$/.test(line)).length).toBe(1);
  });

  test("4. one table in the target exits 2 for the drill, with no pg_restore call", () => {
    writeDrillEnv();
    setSwitch("tables", "1\n");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(2);
    expect(result.output).toContain("--down");
    expect(dockerCalls().some((line) => line.includes("pg_restore"))).toBe(false);
    expect(result.stdout).not.toContain("restore ok");
  });

  test("a table count that is empty or not a number fails the run (exit 1) before pg_restore", () => {
    writeDrillEnv();
    // An empty count is the dangerous one: in `(( ))` it reads as 0 and the restore would run over unknown data.
    for (const value of ["\n", "ERROR\n"]) {
      setSwitch("tables", value);
      expect(run(["--target", "drill", "--stdin"], { stdin: DUMP }).code, JSON.stringify(value)).toBe(1);
    }
    expect(dockerCalls().some((line) => line.includes("pg_restore"))).toBe(false);
  });

  test("5. credentials:check with failed=1 exits 1 and never starts the server", () => {
    writeDrillEnv();
    setSwitch("creds-failed", "1\n");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(1);
    expect(result.output).toContain("restore failed at credentials");
    expect(dockerCalls().some((line) => line.includes(" up -d --no-build --wait"))).toBe(false);
    expect(result.stdout).not.toContain("restore ok");
  });

  test("restore.sh reads the failed count of the real line format: the prefixed line and the bare line, one count each", () => {
    writeDrillEnv();
    for (const [line, code] of [
      [`[credentials-check] ${credentialsLine({ ok: 3, failed: 0 })}\n`, 0],
      [`${credentialsLine({ ok: 3, failed: 0 })}\n`, 0],
      [`[credentials-check] ${credentialsLine({ ok: 3, failed: 2 })}\n`, 1],
      [`${credentialsLine({ ok: 3, failed: 12 })}\n`, 1],
      // A line with another prefix, an extra word or a missing number is no result line.
      [`[other] ${credentialsLine({ ok: 3, failed: 0 })}\n`, 1],
      [`[credentials-check] ${credentialsLine({ ok: 3, failed: 0 })} extra\n`, 1],
      ["[credentials-check] credentials ok=3 failed=\n", 1],
    ] as const) {
      setSwitch("creds-line", line);
      expect(run(["--target", "drill", "--stdin"], { stdin: DUMP }).code, line).toBe(code);
    }
  });

  test("TG1. restore.sh needs exactly one exact result line: two lines fail with no up and no line content in the message", () => {
    writeDrillEnv();
    const good = `[credentials-check] ${credentialsLine({ ok: 3, failed: 0 })}`;
    const bad = `[credentials-check] ${credentialsLine({ ok: 3, failed: 2 })}`;
    for (const [text, why] of [
      [`${bad}\n${good}\n`, "failed=2 then failed=0"],
      [`${good}\n${good}\n`, "two identical good lines"],
      [`${good}\n${bad}\n`, "failed=0 then failed=2"],
    ] as const) {
      rmSync(join(root, "calls.log"), { force: true });
      setSwitch("creds-line", text);
      const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
      expect(result.code, why).toBe(1);
      expect(result.output, why).toContain("printed 2 result lines, not exactly 1");
      expect(
        result.output
          .split("\n")
          .filter((line) => line.startsWith("restore:"))
          .join("\n"),
        why
      ).not.toContain("ok=");
      expect(
        dockerCalls().some((line) => line.includes(" up -d --no-build --wait")),
        why
      ).toBe(false);
      expect(result.stdout, why).not.toContain("restore ok");
    }
  });

  test("TG1. one exact result line with noise lines around it passes", () => {
    writeDrillEnv();
    setSwitch(
      "creds-line",
      `noise before\n[credentials-check] ${credentialsLine({ ok: 3, failed: 0 })}\nnoise after credentials ok=1 failed=9\n`
    );
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(0);
    expect(lastLine(result.stdout)).toMatch(/^restore ok target=drill seconds=\d+$/);
  });

  test("the failed count is read from the result line, whatever else the call prints before it", () => {
    writeDrillEnv();
    setSwitch("creds-line", `warm-up noise\n[credentials-check] ${credentialsLine({ ok: 1, failed: 1 })}\n`);
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(1);
    expect(result.output).toContain("1 mailbox secrets do not open");
  });

  test("a credentials:check that prints no result line exits 1 and never starts the server", () => {
    writeDrillEnv();
    setSwitch("creds-line", "something went wrong\n");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(1);
    expect(dockerCalls().some((line) => line.includes(" up -d --no-build --wait"))).toBe(false);
  });

  test("a failed pg_restore exits 1, runs no later step and names the step", () => {
    writeDrillEnv();
    setSwitch("docker-fail", "pg_restore");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(1);
    expect(result.output).toContain("restore failed at pg_restore");
    expect(dockerCalls().some((line) => line.includes("update mailboxes"))).toBe(false);
  });

  test("6. --down drill runs `down -v` in project ea-drill, then `image rm ea-drill-server`, never --rmi, and removes drill.env", () => {
    writeDrillEnv();
    const result = run(["--target", "drill", "--down"]);
    expect(result.code).toBe(0);
    const lines = dockerCalls();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith(`${DRILL_PREFIX} down -v `);
    expect(lines[1]).toStartWith("docker image rm ea-drill-server ");
    expect(lines.join("\n")).not.toContain("--rmi");
    expect(existsSync(join(root, "deploy", "drill.env"))).toBe(false);
  });

  test("--down without deploy/drill.env exits 2; a missing image does not fail the down", () => {
    expect(run(["--target", "drill", "--down"]).code).toBe(2);
    expect(dockerCalls()).toEqual([]);
    writeDrillEnv();
    setSwitch("docker-fail", "image rm");
    expect(run(["--target", "drill", "--down"]).code).toBe(0);
  });

  test("6b. --down with new-host exits 2 and calls no docker", () => {
    const result = run(["--target", "new-host", "--down"]);
    expect(result.code).toBe(2);
    expect(dockerCalls()).toEqual([]);
  });
});

describe("restore.sh new-host", () => {
  test("uses the live compose command, keeps the mailboxes, clears the sessions and prints the replay pointer before the last line", () => {
    const result = run(["--target", "new-host", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(0);
    const lines = dockerCalls();
    for (const line of lines) {
      expect(line.startsWith("docker compose -f deploy/compose.yaml --env-file .env "), line).toBe(true);
    }
    const text = lines.join("\n");
    expect(text).not.toContain("ea-drill");
    expect(text).not.toContain("update mailboxes");
    expect(text).not.toContain("ops_alerts");
    expect(text).toContain("delete from auth_sessions");
    expect(lines.filter((line) => line.includes("pg_restore"))[0]).toContain(`stdin=${DUMP.length} `);
    // 10. the migrate step runs the `migrate` service; credentials:check stays in `cli`
    const migrate = indexOfCall(lines, "run --rm -T migrate");
    const creds = indexOfCall(lines, "run --rm -T cli bun run credentials:check");
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(creds).toBeGreaterThan(migrate);
    expect(lines.some((line) => line.includes("db:migrate"))).toBe(false);
    const out = result.stdout.trim().split("\n");
    expect(out.at(-1)).toMatch(/^restore ok target=new-host seconds=\d+$/);
    expect(out.at(-2)).toContain("deleted <org id>");
    expect(out.at(-2)).toContain("record: dsr erase");
  });

  test("4b. one table in the target exits 2 and never restores over data, with no build call", () => {
    setSwitch("tables", "3\n");
    const result = run(["--target", "new-host", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(2);
    // A build would retag the live ea-server image before the refusal.
    expect(dockerCalls().some((line) => / build /.test(line))).toBe(false);
    expect(
      dockerCalls().map(
        (line) => line.replace(/^docker compose -f deploy\/compose.yaml --env-file .env /, "").split(" ")[0]
      )
    ).toEqual(["up", "exec", "exec"]);
    expect(result.output).toContain("never goes over data");
    expect(dockerCalls().some((line) => line.includes("pg_restore"))).toBe(false);
  });
});

describe("restore.sh waits for the final database server (step db-ready)", () => {
  test("F139-1. a drill on a fresh volume waits for the TCP answer; init-probes=3 means 4 probes and 3 pauses", () => {
    writeDrillEnv();
    setSwitch("init-probes", "3\n");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.output).not.toContain("restore failed at");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("db ready probes=4");
    expect(lastLine(result.stdout)).toMatch(/^restore ok target=drill seconds=\d+$/);
    const lines = dockerCalls();
    const up = indexOfCall(lines, " up -d --wait db");
    const firstTables = indexOfCall(lines, "pg_tables");
    const probes = lines.map((line, index) => (line.includes(PROBE) ? index : -1)).filter((index) => index >= 0);
    expect(probes).toHaveLength(4);
    for (const index of probes) {
      expect(index).toBeGreaterThan(up);
      expect(index).toBeLessThan(firstTables);
    }
    expect(sleepCalls()).toEqual(["sleep 1", "sleep 1", "sleep 1"]);
  });

  test("F139-2. a new-host restore waits the same way", () => {
    setSwitch("init-probes", "3\n");
    const result = run(["--target", "new-host", "--stdin"], { stdin: DUMP });
    expect(result.output).not.toContain("restore failed at");
    expect(result.code).toBe(0);
    const lines = dockerCalls();
    const firstTables = indexOfCall(lines, "pg_tables");
    const probes = lines.map((line, index) => (line.includes(PROBE) ? index : -1)).filter((index) => index >= 0);
    expect(probes).toHaveLength(4);
    for (const index of probes) expect(index).toBeLessThan(firstTables);
    expect(result.stdout).toContain("db ready probes=4");
  });

  test("F139-3. a server that never answers on TCP exits 1 at db-ready after 60 probes and 59 pauses, with no later step", () => {
    writeDrillEnv();
    setSwitch("never-ready", "1\n");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(1);
    expect(result.output).toContain("restore: the database did not answer on TCP after 60 probes");
    expect(result.output).toContain("restore failed at db-ready");
    expect(probeCalls()).toHaveLength(60);
    expect(sleepCalls()).toHaveLength(59);
    expect(dockerCalls().some((line) => line.includes("pg_tables"))).toBe(false);
    expect(dockerCalls().some((line) => / build /.test(line))).toBe(false);
    expect(dockerCalls().some((line) => line.includes("pg_restore"))).toBe(false);
    expect(result.stdout).not.toContain("restore ok");
  });

  test("F139-4. a volume that holds data passes the wait at once (1 probe, no pause) and guard-empty refuses with exit 2", () => {
    writeDrillEnv();
    setSwitch("tables", "1\n");
    const result = run(["--target", "drill", "--stdin"], { stdin: DUMP });
    expect(result.code).toBe(2);
    expect(result.output).toContain("--down");
    expect(result.stdout).toContain("db ready probes=1");
    expect(probeCalls()).toHaveLength(1);
    expect(sleepCalls()).toHaveLength(0);
    expect(dockerCalls().some((line) => line.includes("pg_restore"))).toBe(false);
  });

  test("F139-5. every probe reads no stdin and runs in project ea-drill", () => {
    writeDrillEnv();
    setSwitch("init-probes", "2\n");
    expect(run(["--target", "drill", "--stdin"], { stdin: DUMP }).code).toBe(0);
    const probes = probeCalls();
    expect(probes).toHaveLength(3);
    for (const line of probes) {
      expect(line, line).toContain(" -p ea-drill ");
      expect(line, line).toMatch(/ stdin=0 /);
    }
  });
});

describe("restore.sh source rules", () => {
  const source = readFileSync(join(DEPLOY, "restore.sh"), "utf8");

  test("bash -n passes, and the script never passes a profile, --rmi or the live project name to docker", () => {
    expect(Bun.spawnSync(["bash", "-n", join(DEPLOY, "restore.sh")]).exitCode).toBe(0);
    // Comments may name them; the code never uses them.
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(code).not.toContain("--profile");
    expect(code).not.toContain("--rmi");
    expect(source).toContain("set -euo pipefail");
  });
});
