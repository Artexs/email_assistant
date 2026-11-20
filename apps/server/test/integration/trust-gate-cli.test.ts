import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import { setOrgFeature } from "../../src/modules/tenancy";
import { runningEvidenceKey } from "../../src/modules/triage";
import { llmRoleTable, loadConfig } from "../../src/platform/config";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

// The CLI reads the same gate files and the same running key as the server: with the flag `trust_ladder`
// on and a gate file for the running key, `mailbox:settings auto` is no stricter than `PATCH /api/settings/.../auto`.
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const settingsScript = resolve(import.meta.dir, "../../src/scripts/mailbox-settings.ts");
const REAL_FILE = join(repoRoot, "evals/results/gate/classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.json");

afterAll(async () => {
  await db.destroy();
});

// A gate file for the key the CLI will run on (same env as this process): a copy of the committed lab file, not provisional.
function writeGateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "f110-cli-gate-"));
  const key = runningEvidenceKey(llmRoleTable(loadConfig()));
  const file = JSON.parse(readFileSync(REAL_FILE, "utf8")) as Record<string, unknown>;
  writeFileSync(
    join(dir, "classifier-cli.json"),
    JSON.stringify({
      ...file,
      provider: key.provider,
      model: key.model,
      reasoningEffort: key.reasoningEffort,
      promptVersion: key.promptVersion,
      endpoint: key.endpoint,
      host: key.host,
      provisional: false,
    })
  );
  return dir;
}

async function runCli(orgId: string, mailboxId: string, category: string, env: Record<string, string | undefined>) {
  const proc = Bun.spawn(
    [
      "bun",
      settingsScript,
      "auto",
      "--org-id",
      orgId,
      "--mailbox-id",
      mailboxId,
      "--category",
      category,
      "--value",
      "on",
    ],
    { cwd: repoRoot, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, out: `${stdout}${stderr}` };
}

async function cleanup(created: { orgId: string; userId: string }): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
  await db.deleteFrom("users").where("id", "=", created.userId).execute();
}

describe("bun run mailbox:settings auto with the flag trust_ladder", () => {
  test("a gate file for the running key turns auto on with no force, and the grant holds the running key", async () => {
    const dir = writeGateDir();
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      await insertDefaultSettings(db, ctx, created.mailboxId);
      await setOrgFeature(db, ctx, { flag: "trust_ladder", enabled: true, actor: "cli", now: new Date() });
      const result = await runCli(created.orgId, created.mailboxId, "info", { GATE_EVIDENCE_DIR: dir });
      expect(result.code).toBe(0);
      const row = await db
        .selectFrom("mailbox_settings")
        .select("category_policy")
        .where("mailbox_id", "=", created.mailboxId)
        .executeTakeFirstOrThrow();
      const key = runningEvidenceKey(llmRoleTable(loadConfig()));
      expect(row.category_policy).toMatchObject({ info: { auto: true, grant: { by: "evidence", key } } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await cleanup(created);
    }
  });

  test("no gate file for the running key: exit 1 and the block names the missing evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "f110-cli-gate-empty-"));
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      await insertDefaultSettings(db, ctx, created.mailboxId);
      await setOrgFeature(db, ctx, { flag: "trust_ladder", enabled: true, actor: "cli", now: new Date() });
      const result = await runCli(created.orgId, created.mailboxId, "info", { GATE_EVIDENCE_DIR: dir });
      expect(result.code).toBe(1);
      expect(result.out).toContain("refused: info did not pass go/no-go (no_global)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await cleanup(created);
    }
  });
});
