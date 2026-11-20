import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createDb } from "../../src/platform/db";

import { createOrgWithMailbox, seedSenderActivity } from "./fixtures";
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

  test("an unknown job name exits 2 with the usage line and runs nothing", async () => {
    const result = await runJob(["--name", "no.such.job"]);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("[job-run] --name is a job name");
    expect(result.stderr).toContain("[job-run] usage: bun run job:run --name actions.expiry|");
  });

  // The chaser branch. The alias line comes after the run; a mailbox that fails gives exit 1.
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

  // The sweep needs no model and no LLM scope; it prints counts only.
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

  // The profile pass: counts only. A mailbox whose write fails gives exit 1, and the failure text (here with the address, the
  // key hash and the subject in it) never reaches stdout or stderr.
  test("contacts.refresh prints the counts line and exits 0; a mailbox that fails gives exit 1 and leaks no address", async () => {
    const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
    if (ownerUrl === undefined) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role makes the trigger");
    const owner = createDb(ownerUrl);
    const created = await db.transaction().execute(async (trx) => {
      const org = await createOrgWithMailbox(trx);
      const ctx = { orgId: org.orgId };
      await setOrgFeature(trx, ctx, { flag: "sender_context", enabled: true, actor: "cli", now: new Date() });
      await seedSenderActivity(trx, ctx, org.mailboxId, {
        address: "anna.cli@acme.pl",
        mails: [{ at: new Date(Date.now() - 24 * 3_600_000) }],
      });
      return org;
    });
    const fn = `cli_fail_${created.mailboxId.replaceAll("-", "")}`;
    try {
      const ok = await runJob(["--name", "contacts.refresh"]);
      expect(ok.code).toBe(0);
      expect(ok.stdout).toMatch(
        /\[job-run\] contacts\.refresh: ran once \(mailboxes \d+, skipped \d+, written \d+, unchanged \d+, zeroed \d+, mailbox errors 0\)/
      );
      expect(ok.stdout).toMatch(/written [1-9]/);
      expect(ok.stdout + ok.stderr).not.toContain("@");

      // A trigger that fails the next write of this mailbox with the address in the message.
      await sql
        .raw(
          `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
             IF NEW.mailbox_id = '${created.mailboxId}' THEN
               RAISE EXCEPTION 'MARKER anna.cli@acme.pl %', NEW.key_hash USING DETAIL = 'Subject: MARKER-SUBJECT';
             END IF;
             RETURN NEW;
           END $f$`
        )
        .execute(owner);
      await sql
        .raw(`CREATE TRIGGER ${fn} BEFORE UPDATE ON sender_profiles FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
        .execute(owner);
      // A new mail changes the stored row, so the next pass tries the UPDATE.
      await db.transaction().execute(async (trx) => {
        await seedSenderActivity(trx, { orgId: created.orgId }, created.mailboxId, {
          address: "anna.cli@acme.pl",
          mails: [{ at: new Date(Date.now() - 3_600_000) }],
        });
      });
      const failed = await runJob(["--name", "contacts.refresh"]);
      expect(failed.code).toBe(1);
      expect(failed.stdout).toMatch(/contacts\.refresh: ran once \(.*mailbox errors [1-9]\)/);
      const text = failed.stdout + failed.stderr;
      expect(text).not.toContain("@");
      expect(text).not.toContain("anna");
      expect(text).not.toContain("MARKER");
      expect(text).not.toMatch(/[0-9a-f]{64}/);
    } finally {
      await sql.raw(`DROP TRIGGER IF EXISTS ${fn} ON sender_profiles`).execute(owner);
      await sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`).execute(owner);
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
      await owner.destroy();
    }
  });
});
