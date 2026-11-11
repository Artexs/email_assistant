import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const rulesScript = resolve(import.meta.dir, "../../src/scripts/rules.ts");

let orgId = "";
let userId = "";

beforeAll(async () => {
  const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
  orgId = created.orgId;
  userId = created.userId;
});

afterAll(async () => {
  await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
  await db.destroy();
});

async function runRules(args: string[]) {
  const proc = Bun.spawn(["bun", rulesScript, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

async function auditRows() {
  return db
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "rule.added")
    .execute();
}

describe("rules:add", () => {
  test("adds a rule with an audit row of actor cli, a repeat is a no-op", async () => {
    const args = ["add", "--org-id", orgId, "--pattern", "Boss@Firma.test", "--kind", "vip"];
    const first = await runRules(args);
    expect({ code: first.code, stdout: first.stdout }).toEqual({ code: 0, stdout: "added vip boss@firma.test\n" });
    const rows = await auditRows();
    expect(rows.map((row) => row.actor)).toEqual(["cli"]);
    expect(rows[0]?.data).toMatchObject({ kind: "vip", scope: "org" });

    const second = await runRules(args);
    expect({ code: second.code, stdout: second.stdout }).toEqual({
      code: 0,
      stdout: "already there: vip boss@firma.test\n",
    });
    expect(await auditRows()).toHaveLength(1);
  });

  test("a pattern without a local part and a domain is refused with the usage", async () => {
    const result = await runRules(["add", "--org-id", orgId, "--pattern", "@firma.test", "--kind", "vip"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("usage:");
  });

  test("an unknown mailbox is refused", async () => {
    const result = await runRules([
      "add",
      "--org-id",
      orgId,
      "--mailbox-id",
      randomUUID(),
      "--pattern",
      "a@firma.test",
      "--kind",
      "whitelist",
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refused: mailbox not found");
  });
});
