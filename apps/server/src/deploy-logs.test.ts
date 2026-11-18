import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

// deploy/logs.sh prints the server log as text lines and filters it by run, request, event and level.
// The hidden option --stdin reads lines from stdin; a fake `docker` on PATH shows the command the script builds without it.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const script = join(repoRoot, "deploy", "logs.sh");
const dir = mkdtempSync(join(tmpdir(), "f103-s18-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

if (Bun.which("jq") === null) {
  throw new Error("deploy-logs.test.ts needs jq on PATH (install jq, then run again)");
}

const run = (args: string[], stdin = "", env: Record<string, string> = {}, cwd = repoRoot) => {
  const result = Bun.spawnSync(["bash", script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdin: new TextEncoder().encode(stdin),
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
};
const json = (fields: Record<string, unknown>): string =>
  JSON.stringify({ time: "2026-11-20T10:00:00.000Z", level: "info", module: "mail", ...fields });
const lines = (...items: string[]): string => `${items.join("\n")}\n`;

describe("deploy/logs.sh", () => {
  test("filters by run and prints one text line; a non-JSON line is dropped", () => {
    const input = lines(
      json({ event: "sync_done", msg: "sync_done", run_id: "r-1", count: 3 }),
      json({ event: "sync_done", msg: "sync_done", run_id: "r-2" }),
      "not json at all"
    );
    const result = run(["--stdin", "--run", "r-1"], input);
    expect(result.code).toBe(0);
    expect(result.out).toBe("2026-11-20T10:00:00.000Z info [mail] sync_done run_id=r-1 count=3\n");
  });

  test("--level warn keeps the warn line and drops the info line", () => {
    const input = lines(
      json({ event: "sync_done", run_id: "r-1" }),
      json({ level: "warn", event: "sync_soft_error", run_id: "r-1" })
    );
    const result = run(["--stdin", "--level", "warn"], input);
    expect(result.code).toBe(0);
    expect(result.out).toBe("2026-11-20T10:00:00.000Z warn [mail] sync_soft_error run_id=r-1\n");
  });

  test("--level warn keeps error lines too", () => {
    const input = lines(json({ level: "error", event: "boom" }), json({ level: "debug", event: "quiet" }));
    expect(run(["--stdin", "--level", "warn"], input).out).toBe("2026-11-20T10:00:00.000Z error [mail] boom\n");
  });

  test("--request and --event filter on their own field", () => {
    const input = lines(
      json({ event: "http_request", request_id: "q-1" }),
      json({ event: "http_request", request_id: "q-2" }),
      json({ event: "other", request_id: "q-1" })
    );
    expect(run(["--stdin", "--request", "q-1", "--event", "http_request"], input).out).toBe(
      "2026-11-20T10:00:00.000Z info [mail] http_request request_id=q-1\n"
    );
    expect(run(["--stdin", "--request", "q-1"], input).out.split("\n").filter(Boolean)).toHaveLength(2);
    expect(run(["--stdin", "--event", "http_request"], input).out.split("\n").filter(Boolean)).toHaveLength(2);
  });

  test("a filter value is data, not jq code", () => {
    const input = lines(json({ event: "a", run_id: "r-1" }));
    const result = run(["--stdin", "--run", '" or true or "'], input);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  test("an unknown option, a missing or empty value, and an unknown level exit 2 with the usage", () => {
    for (const args of [["--bad"], ["--run"], ["--run", ""], ["--level", "loud"]]) {
      const result = run(args);
      expect(result.code).toBe(2);
      expect(result.err).toContain("usage: bash deploy/logs.sh");
      expect(result.out).toBe("");
    }
  });

  test("without --stdin it reads `docker compose logs` of the server with --since and --follow", () => {
    const bin = join(dir, "bin");
    Bun.spawnSync(["mkdir", "-p", bin]);
    const fake = join(bin, "docker");
    writeFileSync(
      fake,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >&2\nprintf '%s\\n' '${json({ event: "from_docker", run_id: "r-9" })}'\n`
    );
    chmodSync(fake, 0o755);
    const result = run(["--since", "2h", "--follow", "--run", "r-9"], "", { PATH: `${bin}:${process.env.PATH ?? ""}` });
    expect(result.code).toBe(0);
    expect(result.err).toContain(
      "compose -f deploy/compose.yaml --env-file .env logs --no-log-prefix --since 2h --follow server"
    );
    expect(result.out).toBe("2026-11-20T10:00:00.000Z info [mail] from_docker run_id=r-9\n");
    const plain = run([], "", { PATH: `${bin}:${process.env.PATH ?? ""}` });
    expect(plain.err).toContain("logs --no-log-prefix --since 1h server");
  });

  test("a line with a non-string level is printed, not dropped", () => {
    const input = lines(JSON.stringify({ time: "T", level: 30, module: "mail", event: "odd" }));
    const result = run(["--stdin", "--level", "info"], input);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toBe("T 30 [mail] odd\n");
    const object = run(
      ["--stdin"],
      lines(JSON.stringify({ time: "T", level: { a: 1 }, module: "mail", event: "odd" }))
    );
    expect(object.err).toBe("");
    expect(object.out).toBe('T {"a":1} [mail] odd\n');
  });

  test("it runs from the repo root whatever the caller's directory is", () => {
    const bin = join(dir, "bin-pwd");
    Bun.spawnSync(["mkdir", "-p", bin]);
    const fake = join(bin, "docker");
    writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$PWD" >&2\n`);
    chmodSync(fake, 0o755);
    const result = run([], "", { PATH: `${bin}:${process.env.PATH ?? ""}` }, tmpdir());
    expect(result.code).toBe(0);
    expect(result.err.trim()).toBe(repoRoot);
  });

  test("--follow gives jq --unbuffered; without --follow it does not", () => {
    const bin = join(dir, "bin-jq");
    Bun.spawnSync(["mkdir", "-p", bin]);
    writeFileSync(join(bin, "docker"), "#!/usr/bin/env bash\nexit 0\n");
    writeFileSync(join(bin, "jq"), `#!/usr/bin/env bash\nprintf 'jq %s\\n' "$*" >&2\nexec ${Bun.which("jq")} "$@"\n`);
    chmodSync(join(bin, "docker"), 0o755);
    chmodSync(join(bin, "jq"), 0o755);
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    expect(run(["--follow"], "", env).err).toContain("--unbuffered");
    expect(run([], "", env).err).not.toContain("--unbuffered");
  });
});
