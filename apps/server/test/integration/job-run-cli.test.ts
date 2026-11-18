import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();
afterAll(async () => {
  await db.destroy();
});

const repoRoot = resolve(import.meta.dir, "../../../..");
const script = resolve(import.meta.dir, "../../src/scripts/job-run.ts");

async function runJob(args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  return {
    code,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

describe("job:run CLI", () => {
  test("the committer warning goes to stderr and the result line to stdout", async () => {
    const result = await runJob(["--name", "actions.committer"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("[job-run] do not run the committer here while the server runs");
    expect(result.stdout).not.toContain("do not run the committer");
    expect(result.stdout).toContain("[job-run] actions.committer: ran once");
    expect(result.stderr).not.toContain("ran once");
  });

  // F116 stage 15 review: the chaser branch. The alias line comes after the run; a mailbox that fails gives exit 1.
  test("loops.chaser and its alias print the counts line; only the alias prints the alias line, after the run", async () => {
    const plain = await runJob(["--name", "loops.chaser"]);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain("[job-run] loops.chaser: ran once (mailboxes ");
    expect(plain.stdout).not.toContain("alias");

    const alias = await runJob(["--name", "delegation.chaser"]);
    expect(alias.code).toBe(0);
    const lines = alias.stdout.split("\n").filter((line) => line.startsWith("[job-run]"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("delegation.chaser: ran once");
    expect(lines[1]).toContain("delegation.chaser is an alias of loops.chaser");
  });

  // F115 stage 09: the sweep needs no model and no LLM scope; it prints counts only.
  test("replies.sweep runs once without the model and prints a counts line", async () => {
    const result = await runJob(["--name", "replies.sweep"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /\[job-run\] replies\.sweep: ran once \(mailboxes \d+, checked \d+, answered \d+, newer mail \d+, original moved \d+, suspicious \d+, policy changed \d+, skipped \d+, mailbox errors 0\)/
    );
    expect(result.stdout + result.stderr).not.toContain("TRIAGE_LLM_SCOPE");
  });

  test("a mailbox that fails makes the chaser exit 1, and the counts line names the error", async () => {
    const created = await db.transaction().execute(async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      await insertDefaultSettings(trx, ctx, org.mailboxId);
      await updateMailboxSettings(trx, ctx, org.mailboxId, {
        mode: "assist",
        toolSwitches: { move: false, mark_read: false, flag: false, create_draft: true, move_unsure: false },
      });
      // A time zone that the clock code refuses: the run of this mailbox throws, the others go on.
      await trx
        .updateTable("organizations")
        .set({ timezone: "123456:MARKER-TZ" })
        .where("id", "=", org.orgId)
        .execute();
      return org;
    });
    try {
      const result = await runJob(["--name", "loops.chaser"]);
      expect(result.code).toBe(1);
      expect(result.stdout).toMatch(/mailbox errors [1-9]/);
      expect(result.stdout + result.stderr).not.toContain("MARKER");
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});
