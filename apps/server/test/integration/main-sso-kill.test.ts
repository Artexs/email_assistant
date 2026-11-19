import { randomUUID } from "node:crypto";
import path from "node:path";

import { afterAll, afterEach, expect, test } from "bun:test";

import { createOrganizationWithOwner } from "../../src/modules/tenancy";

import { testDb } from "./helpers";

// Start-up wiring of `main.ts` (ADR 0026 point 6): with `FEATURES_OFF` holding `sso_sign_in`, an organization that
// requires SSO makes the line `sso_flag_killed_with_sso_required` with a `count`. Without the kill there is no such line.
// Remove the call in `main.ts` and this test fails. The shared test database may hold other such organizations, so the count is "at least 1".
const db = testDb();
const repoRoot = path.resolve(import.meta.dir, "../../../..");

const orgIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  for (const orgId of orgIds.splice(0)) await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  const ids = userIds.splice(0);
  if (ids.length > 0) await db.deleteFrom("users").where("id", "in", ids).execute();
});

afterAll(async () => {
  await db.destroy();
});

async function seedSsoRequiredOrg(): Promise<void> {
  const { orgId, userId } = await createOrganizationWithOwner(db, {
    orgName: "Sso kill wiring",
    timezone: "Europe/Warsaw",
    email: `sso-kill-${randomUUID()}@x.test`,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userIds.push(userId);
  await db.updateTable("organizations").set({ sso_required: true }).where("id", "=", orgId).execute();
}

// Starts `main.ts` with nothing that reaches the outside, waits for `server_listening`, stops it and returns the JSON lines.
async function startMain(extraEnv: Record<string, string>): Promise<Record<string, unknown>[]> {
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
      TELEGRAM_BOT_TOKEN: "",
      OPERATOR_TELEGRAM_CHAT_ID: "",
      WEB_BASE_URL: "",
      HEARTBEAT_URL: "",
      TRIAGE_LLM_SCOPE: "off",
      ACTIONS_SCOPE: "off",
      SEND_SCOPE: "off",
      FEATURES_OFF: "",
      ...extraEnv,
    },
  });

  // Warnings go to stderr, the rest to stdout: read both until `server_listening`, then stop the process.
  let stdout = "";
  const stderrText = new Response(proc.stderr).text();
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
    await proc.exited;
  } finally {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }
  return `${stdout}\n${await stderrText}`
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const killLines = (lines: Record<string, unknown>[]) =>
  lines.filter((line) => line.event === "sso_flag_killed_with_sso_required");

test("main.ts logs sso_flag_killed_with_sso_required when sso_sign_in is killed and an organization requires SSO", async () => {
  await seedSsoRequiredOrg();
  const lines = await startMain({ FEATURES_OFF: "sso_sign_in" });
  const found = killLines(lines);
  expect(found).toHaveLength(1);
  expect(found[0]?.module).toBe("main");
  expect(found[0]?.level).toBe("warn");
  expect(Number(found[0]?.count)).toBeGreaterThanOrEqual(1);
  expect(lines.some((line) => line.event === "sso_flag_check_failed")).toBe(false);
}, 45_000);

test("main.ts logs no sso_flag_killed_with_sso_required without the kill, with the same organization", async () => {
  await seedSsoRequiredOrg();
  const lines = await startMain({});
  expect(lines.some((line) => line.event === "server_listening")).toBe(true);
  expect(killLines(lines)).toEqual([]);
}, 45_000);
