import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { MINUTE_MS } from "@ea/core";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";

import { createOrgWithMailbox, insertDraftAndSend } from "./fixtures";
import { testDb } from "./helpers";

// On the command line: `bun run mailbox:settings switch --name reply_drafts` (guard, closing rule) and
// `bun run mailbox:profile`. `print` goes to stdout, `fail` to stderr (createCliOutput).
const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const settingsScript = resolve(import.meta.dir, "../../src/scripts/mailbox-settings.ts");
const profileScript = resolve(import.meta.dir, "../../src/scripts/mailbox-profile.ts");
const CANARY = "CANARY-signature-Zofia";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "replies-cli-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await db.destroy();
});

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(script: string, args: string[]): Promise<Result> {
  const proc = Bun.spawn(["bun", script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, MAIL_ALLOW_LOCAL_HOSTS: "true" },
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

async function box(opts: { oauth?: boolean } = {}) {
  return db.transaction().execute(async (trx) => {
    const created = await createOrgWithMailbox(trx);
    await insertDefaultSettings(trx, { orgId: created.orgId }, created.mailboxId);
    if (opts.oauth === true) {
      await trx
        .updateTable("mailboxes")
        .set({ oauth_provider: "microsoft" })
        .where("id", "=", created.mailboxId)
        .execute();
    }
    return created;
  });
}

async function removeOrg(orgId: string, userId: string): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", orgId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
}

const idArgs = (created: { orgId: string; mailboxId: string }) => [
  "--org-id",
  created.orgId,
  "--mailbox-id",
  created.mailboxId,
];

async function storedSwitch(mailboxId: string): Promise<unknown> {
  const row = await db
    .selectFrom("mailbox_settings")
    .select("tool_switches")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return (row.tool_switches as Record<string, unknown>).reply_drafts;
}

describe("mailbox:settings switch --name reply_drafts", () => {
  test(
    "a password mailbox: on is stored and shown; off closes the open reply send and prints the count",
    async () => {
      const created = await box();
      try {
        const args = ["switch", ...idArgs(created), "--name", "reply_drafts"];
        const on = await run(settingsScript, [...args, "--value", "on"]);
        expect(on.code).toBe(0);
        expect(on.stderr).toBe("");
        expect(on.stdout).toContain("switch reply_drafts: off -> on");
        expect(await storedSwitch(created.mailboxId)).toBe(true);

        await db
          .updateTable("mailbox_settings")
          .set({ mode: "assist" })
          .where("mailbox_id", "=", created.mailboxId)
          .execute();
        const reply = await db
          .transaction()
          .execute((trx) => insertDraftAndSend(trx, { orgId: created.orgId }, created.mailboxId, { kind: "reply" }));
        const off = await run(settingsScript, [...args, "--value", "off"]);
        expect(off.code).toBe(0);
        expect(off.stdout).toContain("switch reply_drafts: on -> off");
        expect(off.stdout).toContain("expired 1 ready actions and sends");
        const send = await db
          .selectFrom("actions")
          .select(["status", "status_reason"])
          .where("id", "=", reply.sendId)
          .executeTakeFirstOrThrow();
        expect(send).toEqual({ status: "expired", status_reason: "policy_changed" });
      } finally {
        await removeOrg(created.orgId, created.userId);
      }
    },
    MINUTE_MS
  );

  test(
    "4. an OAuth mailbox: on exits 1 with the code on stderr and stores nothing; off exits 0",
    async () => {
      const created = await box({ oauth: true });
      try {
        const args = ["switch", ...idArgs(created), "--name", "reply_drafts"];
        const on = await run(settingsScript, [...args, "--value", "on"]);
        expect(on.code).toBe(1);
        expect(on.stdout).toBe("");
        expect(on.stderr).toContain("oauth_mailbox");
        expect(await storedSwitch(created.mailboxId)).not.toBe(true);
        const audits = await db
          .selectFrom("audit_log")
          .select("id")
          .where("org_id", "=", created.orgId)
          .where("event", "=", "mailbox.switch_changed")
          .execute();
        expect(audits).toEqual([]);

        const off = await run(settingsScript, [...args, "--value", "off"]);
        expect(off.code).toBe(0);
        expect(off.stdout).toContain("no change");
      } finally {
        await removeOrg(created.orgId, created.userId);
      }
    },
    MINUTE_MS
  );
});

describe("mailbox:profile", () => {
  test(
    "sets the name and the files, prints counts and never a signature text; an empty value clears the field",
    async () => {
      const created = await box();
      try {
        const args = idArgs(created);
        const sigFile = join(dir, "signature.txt");
        await writeFile(sigFile, `Anna Nowak\n${CANARY}\n`);
        const styleFile = join(dir, "style.txt");
        await writeFile(styleFile, "Short and warm.");

        const set = await run(profileScript, [
          ...args,
          "--display-name",
          "Anna Nowak",
          "--signature-file",
          sigFile,
          "--style-file",
          styleFile,
        ]);
        expect(set.code).toBe(0);
        expect(set.stderr).toBe("");
        expect(set.stdout).toContain("[mailbox-profile] display name: Anna Nowak");
        expect(set.stdout).toContain("changed: displayName, signature, writingStyle");
        expect(set.stdout).not.toContain("CANARY");
        const row = await db
          .selectFrom("mailbox_profiles")
          .select(["display_name", "signature", "writing_style", "updated_by"])
          .where("mailbox_id", "=", created.mailboxId)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({
          display_name: "Anna Nowak",
          signature: `Anna Nowak\n${CANARY}`,
          writing_style: "Short and warm.",
          updated_by: null,
        });

        const show = await run(profileScript, args);
        expect(show.code).toBe(0);
        expect(show.stdout).toContain("display name: Anna Nowak");
        expect(show.stdout).not.toContain("CANARY");

        const cleared = await run(profileScript, [...args, "--display-name", ""]);
        expect(cleared.code).toBe(0);
        expect(cleared.stdout).toContain("display name: (not set)");
        const after = await db
          .selectFrom("mailbox_profiles")
          .select("display_name")
          .where("mailbox_id", "=", created.mailboxId)
          .executeTakeFirstOrThrow();
        expect(after.display_name).toBeNull();

        const audit = await db
          .selectFrom("audit_log")
          .select(["actor", "data"])
          .where("org_id", "=", created.orgId)
          .where("event", "=", "mailbox.profile_changed")
          .orderBy("id")
          .execute();
        expect(audit.map((entry) => entry.actor)).toEqual(["cli", "cli"]);
        expect(audit.map((entry) => entry.data)).toEqual([
          { mailbox_id: created.mailboxId, fields: "display_name,signature,writing_style", via: "cli" },
          { mailbox_id: created.mailboxId, fields: "display_name", via: "cli" },
        ]);
      } finally {
        await removeOrg(created.orgId, created.userId);
      }
    },
    MINUTE_MS
  );

  test(
    "a refused name, a long style file or a missing file exits 1; a bad argument exits 2; nothing is stored",
    async () => {
      const created = await box();
      try {
        const args = idArgs(created);
        const bad = await run(profileScript, [...args, "--display-name", "A <x@y>"]);
        expect(bad.code).toBe(1);
        expect(bad.stdout).toBe("");
        expect(bad.stderr).toContain("refused: displayName (bad_character)");
        expect(bad.stderr).not.toContain("x@y");

        const longFile = join(dir, "long.txt");
        await writeFile(longFile, "x".repeat(1001));
        const long = await run(profileScript, [...args, "--style-file", longFile]);
        expect(long.code).toBe(1);
        expect(long.stderr).toContain("refused: writingStyle (too_long)");

        const missing = await run(profileScript, [...args, "--signature-file", join(dir, "missing.txt")]);
        expect(missing.code).toBe(1);
        expect(missing.stderr).toContain("cannot read the signature file");

        const usage = await run(profileScript, ["--mailbox-id", created.mailboxId]);
        expect(usage.code).toBe(2);
        expect(usage.stderr).toContain("usage:");

        const rows = await db
          .selectFrom("mailbox_profiles")
          .select("mailbox_id")
          .where("mailbox_id", "=", created.mailboxId)
          .execute();
        expect(rows).toEqual([]);
      } finally {
        await removeOrg(created.orgId, created.userId);
      }
    },
    MINUTE_MS
  );

  test(
    "a mailbox of another organization is not found: exit 1, nothing stored",
    async () => {
      const a = await box();
      const b = await box();
      try {
        const result = await run(profileScript, [
          "--org-id",
          a.orgId,
          "--mailbox-id",
          b.mailboxId,
          "--display-name",
          "X",
        ]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("no such mailbox in this organization");
        const rows = await db
          .selectFrom("mailbox_profiles")
          .select("mailbox_id")
          .where("mailbox_id", "=", b.mailboxId)
          .execute();
        expect(rows).toEqual([]);
      } finally {
        await removeOrg(a.orgId, a.userId);
        await removeOrg(b.orgId, b.userId);
      }
    },
    MINUTE_MS
  );
});
