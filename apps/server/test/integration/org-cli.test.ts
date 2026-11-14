import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { QUOTA_TIMEZONE, quotaDayStart } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { orgStatusLines } from "../../src/scripts/org-status-lines";

import { createOrgWithMailbox, linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const planScript = resolve(import.meta.dir, "../../src/scripts/org-plan.ts");
const createScript = resolve(import.meta.dir, "../../src/scripts/org-create.ts");

const orgIds: string[] = [];
const userEmails: string[] = [];

afterEach(async () => {
  if (orgIds.length > 0) {
    const members = await db.selectFrom("memberships").select("user_id").where("org_id", "in", orgIds).execute();
    await db.deleteFrom("organizations").where("id", "in", orgIds).execute();
    if (members.length > 0) {
      await db
        .deleteFrom("users")
        .where(
          "id",
          "in",
          members.map((member) => member.user_id)
        )
        .execute();
    }
  }
  if (userEmails.length > 0) {
    await db.deleteFrom("users").where("email", "in", userEmails).execute();
  }
  orgIds.length = 0;
  userEmails.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function run(script: string, args: string[]) {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
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

// Committed, so the spawned script sees it; the `afterEach` deletes it.
async function createActiveOrg(orgName: string) {
  const email = `org-cli-${randomUUID()}@x.test`;
  const { orgId } = await createOrganizationWithOwner(db, {
    orgName,
    timezone: "Europe/Warsaw",
    email,
    displayName: "Owner",
  });
  orgIds.push(orgId);
  userEmails.push(email);
  return { orgId, email };
}

async function planRow(orgId: string) {
  return db
    .selectFrom("organizations")
    .select(["plan", "trial_ends_at", "resumed_at"])
    .where("id", "=", orgId)
    .executeTakeFirstOrThrow();
}

describe("org:plan CLI", () => {
  test("suspend, then resume", async () => {
    const orgName = `Secret Org ${randomUUID()}`;
    const { orgId } = await createActiveOrg(orgName);

    const suspended = await run(planScript, ["--org-id", orgId, "--plan", "suspended"]);
    expect(suspended.code).toBe(0);
    expect(suspended.stdout).toContain("plan active → suspended");
    expect(suspended.stdout).toContain("cancelled 0 queued messages");
    expect(suspended.stdout).not.toContain(orgName);
    expect((await planRow(orgId)).plan).toBe("suspended");

    const resumed = await run(planScript, ["--org-id", orgId, "--plan", "active"]);
    expect(resumed.code).toBe(0);
    expect(resumed.stdout).toContain("plan suspended → active");
    expect(resumed.stdout).not.toContain("resumed_at -");
    expect((await planRow(orgId)).resumed_at).not.toBeNull();
  });

  test("a trial without --trial-days fails", async () => {
    const { orgId } = await createActiveOrg("Trial needed");

    const result = await run(planScript, ["--org-id", orgId, "--plan", "trial"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--trial-days is needed");
    expect((await planRow(orgId)).plan).toBe("active");
  });

  test("an unknown organization fails", async () => {
    const result = await run(planScript, ["--org-id", randomUUID(), "--plan", "active"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("organization not found");
  });
});

describe("org:create CLI", () => {
  test("starts a trial of 30 days by default; active with --trial-days fails", async () => {
    const email = `org-cli-${randomUUID()}@x.test`;
    userEmails.push(email);
    const before = Date.now();

    const created = await run(createScript, [
      "--org-name",
      "Created by CLI",
      "--email",
      email,
      "--display-name",
      "Owner",
    ]);

    expect(created.code).toBe(0);
    const orgId = /created org (\S+) user/.exec(created.stdout)?.[1] ?? "";
    expect(orgId).not.toBe("");
    orgIds.push(orgId);
    const row = await planRow(orgId);
    expect(row.plan).toBe("trial");
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs((row.trial_ends_at?.getTime() ?? 0) - expected)).toBeLessThan(60_000);
    expect(created.stdout).toContain(`plan trial trial_ends_at ${row.trial_ends_at?.toISOString()}`);

    const refused = await run(createScript, [
      "--org-name",
      "Never created",
      "--email",
      `org-cli-${randomUUID()}@x.test`,
      "--display-name",
      "Owner",
      "--plan",
      "active",
      "--trial-days",
      "5",
    ]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("usage: bun run org:create");
  });
});

describe("orgStatusLines", () => {
  test("prints plan, mailbox states, calls and chats as ids and counts", async () => {
    const now = new Date();
    const yesterday = new Date(quotaDayStart(now, QUOTA_TIMEZONE).getTime() - 60 * 60 * 1000);
    const a = await db.transaction().execute(async (trx) => {
      const created = await createOrgWithMailbox(trx, { address: `status-a1-${randomUUID()}@x.test` });
      await trx
        .updateTable("organizations")
        .set({ plan: "trial", trial_ends_at: new Date(now.getTime() + 864e5) })
        .where("id", "=", created.orgId)
        .execute();
      return created;
    });
    const b = await db
      .transaction()
      .execute((trx) => createOrgWithMailbox(trx, { address: `status-b-${randomUUID()}@x.test` }));
    orgIds.push(a.orgId, b.orgId);
    const ctx = { orgId: a.orgId };

    const second = randomUUID();
    await db.transaction().execute(async (trx) => {
      await insertMailbox(trx, ctx, {
        id: second,
        address: `status-a2-${randomUUID()}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await trx.updateTable("mailboxes").set({ status: "auth_error" }).where("id", "=", second).execute();
      for (const at of [now, now, yesterday]) {
        await recordAudit(trx, ctx, {
          actor: "system",
          event: auditEvents.llmCall,
          data: { mailbox_id: a.mailboxId },
          at,
        });
      }
      await linkChat(trx, ctx, a.userId, randomChatId(), now);
    });
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", b.orgId).execute();

    const lines = await orgStatusLines(db, { orgId: a.orgId, now });
    expect(lines).not.toBeNull();
    expect(lines?.[0]).toMatch(
      new RegExp(`^org ${a.orgId} plan=trial trial_ends_at=\\S+ max_mailboxes=\\d+ resumed_at=-$`)
    );
    expect(lines?.[1]).toMatch(
      /^ {2}mailboxes total=2 active=1 paused=0 auth_error=1 host_blocked=0 last_sync=(never|\S+)$/
    );
    expect(lines?.[2]).toBe("  llm_calls_today=2 telegram_chats=1");
    expect(lines).toHaveLength(3);

    const text = (await orgStatusLines(db, { now }))?.join("\n") ?? "";
    expect(text).toContain(`org ${b.orgId} plan=suspended`);
    const names = await db
      .selectFrom("organizations")
      .innerJoin("memberships", "memberships.org_id", "organizations.id")
      .innerJoin("users", "users.id", "memberships.user_id")
      .select(["organizations.name", "users.email"])
      .where("organizations.id", "in", [a.orgId, b.orgId])
      .execute();
    const addresses = await db
      .selectFrom("mailboxes")
      .select("address")
      .where("org_id", "in", [a.orgId, b.orgId])
      .execute();
    for (const row of names) {
      expect(text).not.toContain(row.name);
      expect(text).not.toContain(row.email);
    }
    for (const row of addresses) expect(text).not.toContain(row.address);
  });

  test("an unknown organization gives null", async () => {
    expect(await orgStatusLines(db, { orgId: randomUUID(), now: new Date() })).toBeNull();
  });
});
