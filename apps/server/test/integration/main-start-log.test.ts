import path from "node:path";

import { expect, test } from "bun:test";

import { logFieldNames } from "../../src/platform/log-fields";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const baseKeys = ["time", "level", "module", "event", "msg"];
const allowedKeys = new Set<string>([...baseKeys, ...logFieldNames, "dropped_fields"]);

// F089 acceptance: with LOG_FORMAT=json the server writes one JSON object per line, with the base keys and allow-listed fields only.
test("bun apps/server/src/main.ts writes JSON event lines", async () => {
  // A free port: bind 0, read it, release it.
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);

  const proc = Bun.spawn(["bun", "apps/server/src/main.ts"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LOG_FORMAT: "json",
      LOG_LEVEL: "info",
      PORT: String(port),
      EA_RELEASE: "v0.0.1-test",
      // Nothing reaches the outside: no bot, no web, no heartbeat, no LLM, no mailbox change, no send.
      TELEGRAM_BOT_TOKEN: "",
      OPERATOR_TELEGRAM_CHAT_ID: "",
      WEB_BASE_URL: "",
      HEARTBEAT_URL: "",
      TRIAGE_LLM_SCOPE: "off",
      ACTIONS_SCOPE: "off",
      SEND_SCOPE: "off",
    },
  });

  let stdout = "";
  let stderr = "";
  let exitCode: number;
  try {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + 20_000;
    while (!stdout.includes('"event":"server_listening"') && Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(1, deadline - Date.now()))),
      ]);
      if (next === null || next.done) break;
      stdout += decoder.decode(next.value, { stream: true });
    }
    if (!stdout.includes('"event":"server_listening"')) {
      throw new Error(`no server_listening line in 20 s (${stdout.split("\n").length} stdout lines)`);
    }
    proc.kill("SIGTERM");
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      stdout += decoder.decode(next.value, { stream: true });
    }
    stdout += decoder.decode();
    stderr = await new Response(proc.stderr).text();
    exitCode = await proc.exited;
  } finally {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }

  // 18
  expect(exitCode).toBe(0);

  const output = `${stdout}${stderr}`;
  const lines = output.split("\n").filter((line) => line.trim() !== "");
  const objects = lines.map((line, index) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`line ${index + 1} is not JSON`);
    }
  });

  // 19, 20
  for (const [index, object] of objects.entries()) {
    const keys = Object.keys(object);
    expect(keys.slice(0, baseKeys.length), `line ${index + 1} base keys`).toEqual(baseKeys);
    const stray = keys.filter((key) => !allowedKeys.has(key));
    expect(stray, `line ${index + 1} stray keys`).toEqual([]);
  }

  // Every line carries the release of EA_RELEASE, right after the base keys
  for (const [index, object] of objects.entries()) {
    expect(object.release, `line ${index + 1} release`).toBe("v0.0.1-test");
    expect(Object.keys(object)[baseKeys.length], `line ${index + 1} key after base keys`).toBe("release");
  }

  // 21
  expect(objects.some((o) => o.module === "main" && o.event === "server_listening" && o.port === port)).toBe(true);
  expect(objects.some((o) => o.module === "main" && o.event === "triage_scope" && o.scope === "off")).toBe(true);

  // 22
  expect(objects.filter((o) => o.module === "main" && "dropped_fields" in o)).toEqual([]);

  // 23
  const secret = process.env.CREDENTIALS_KEY;
  if (secret) expect(output.includes(secret)).toBe(false);
  const password = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).password : "";
  if (password) expect(output.includes(password)).toBe(false);
}, 45_000);

// main.ts installs both guards. Remove the wiring and this test fails.
test("main.ts turns a library console.error and an uncaught throw into events and exits 1", async () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);

  const proc = Bun.spawn(
    ["bun", "--preload", "./apps/server/test/integration/wiring-preload.ts", "apps/server/src/main.ts"],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        LOG_FORMAT: "json",
        LOG_LEVEL: "info",
        PORT: String(port),
        TELEGRAM_BOT_TOKEN: "",
        OPERATOR_TELEGRAM_CHAT_ID: "",
        WEB_BASE_URL: "",
        HEARTBEAT_URL: "",
        TRIAGE_LLM_SCOPE: "off",
        ACTIONS_SCOPE: "off",
        SEND_SCOPE: "off",
      },
    }
  );
  const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
  let output: string;
  let exitCode: number;
  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    output = `${stdout}${stderr}`;
    exitCode = await proc.exited;
  } finally {
    clearTimeout(timer);
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }

  expect(exitCode).toBe(1);
  expect(output).not.toContain("MARKER-WIRING");
  const events = output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (JSON.parse(line) as { event: string }).event);
  const listening = events.indexOf("server_listening");
  const consoleOutput = events.indexOf("console_output");
  const uncaught = events.indexOf("process_uncaught_exception");
  expect(listening).toBeGreaterThanOrEqual(0);
  expect(consoleOutput).toBeGreaterThan(listening);
  expect(uncaught).toBeGreaterThan(consoleOutput);
}, 30_000);
