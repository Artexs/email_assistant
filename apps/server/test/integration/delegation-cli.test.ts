import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const scripts = resolve(import.meta.dir, "../../src/scripts");

const mailboxAddress = `box-${randomUUID()}@x.test`;
let orgId = "";
let userId = "";

beforeAll(async () => {
  const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx, { address: mailboxAddress }));
  orgId = created.orgId;
  userId = created.userId;
});

afterAll(async () => {
  await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
  await db.destroy();
});

async function run(script: string, args: string[]) {
  const proc = Bun.spawn(["bun", resolve(scripts, script), ...args], {
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

describe("delegates:add", () => {
  test("a mailbox address of the organization is refused with exit 1 and no row", async () => {
    const result = await run("delegates.ts", ["add", "--org-id", orgId, "--name", "Anna", "--email", mailboxAddress]);
    expect(result).toEqual({
      code: 1,
      stdout: "refused: the address is a mailbox of this organization\n",
      stderr: "",
    });
    const listed = await run("delegates.ts", ["list", "--org-id", orgId, "--all"]);
    expect(listed).toEqual({ code: 0, stdout: "no delegates\n", stderr: "" });
  });

  test("a second address is added, listed and a repeat says it is there already", async () => {
    const args = ["add", "--org-id", orgId, "--name", "Anna", "--email", "anna@y.test"];
    const first = await run("delegates.ts", args);
    expect({ code: first.code, stdout: first.stdout.replace(/[0-9a-f-]{36}/, "<id>") }).toEqual({
      code: 0,
      stdout: "added <id>\n",
    });
    expect(await run("delegates.ts", args)).toEqual({ code: 0, stdout: "already there\n", stderr: "" });
  });
});

describe("delegations:done", () => {
  test("an unknown delegation id exits 1 with the line not found", async () => {
    const result = await run("delegations.ts", ["done", "--org-id", orgId, "--id", randomUUID()]);
    expect(result).toEqual({ code: 1, stdout: "not found\n", stderr: "" });
  });
});
