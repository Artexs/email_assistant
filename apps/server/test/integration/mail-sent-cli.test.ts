import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { DAY_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { insertDefaultSettings } from "../../src/modules/config";
import {
  getSentSyncState,
  insertSentEmails,
  setFolderMapEntry,
  writeSentSwitch,
  type NewSentEmail,
} from "../../src/modules/mail/repo";
import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";

import { createOrgWithMailbox } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const settingsScript = resolve(import.meta.dir, "../../src/scripts/mailbox-settings.ts");
// The script reads the real clock: the rows are dated from it.
const AT = new Date(Math.floor(Date.now() / 1000) * 1000);

type Created = Awaited<ReturnType<typeof createOrgWithMailbox>>;
const created: Created[] = [];

beforeEach(() => {
  configureFeatures({ off: [] });
});

afterEach(async () => {
  for (const box of created) {
    await db.deleteFrom("organizations").where("id", "=", box.orgId).execute();
    await db.deleteFrom("users").where("id", "=", box.userId).execute();
  }
  created.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

// The child process reads its own kill list: a FEATURES_OFF of the machine must not decide the test.
async function runSettings(args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.FEATURES_OFF;
  const proc = Bun.spawn(["bun", settingsScript, ...args], {
    cwd: repoRoot,
    env,
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

// The repository function takes a transaction.
function insertRows(ctx: { orgId: string }, rows: NewSentEmail[]): Promise<number> {
  return db.transaction().execute((trx) => insertSentEmails(trx, ctx, rows));
}

async function setup(opts: { flag: boolean; switchOn?: boolean; rows?: number }) {
  const box = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
  created.push(box);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(db, ctx, box.mailboxId);
  if (opts.flag) await upsertOrgFeature(db, ctx, { flag: "sent_sync", enabled: true, setBy: "test", setAt: AT });
  if (opts.switchOn)
    await db.transaction().execute((trx) => writeSentSwitch(trx, ctx, box.mailboxId, { enabled: true, at: AT }));
  for (let n = 1; n <= (opts.rows ?? 0); n += 1) {
    const at = new Date(AT.getTime() - n * DAY_MS);
    await insertRows(ctx, [
      {
        mailboxId: box.mailboxId,
        dedupKey: `mid:<cli-sent-${n}-${box.mailboxId}@x.test>:h1`,
        path: "Sent",
        uidValidity: 7,
        uid: n,
        messageId: null,
        parentMessageId: null,
        referencesIds: [],
        threadKey: `<cli-sent-${n}-${box.mailboxId}@x.test>`,
        fromAddress: null,
        toAddresses: [],
        ccAddresses: [],
        subject: null,
        sentAt: at,
        internalDate: at,
        origin: "user",
        actionId: null,
        content: "pending",
      },
    ]);
  }
  return {
    ctx,
    args: (value: "on" | "off") => [
      "sent-sync",
      "--org-id",
      box.orgId,
      "--mailbox-id",
      box.mailboxId,
      "--value",
      value,
    ],
    box,
  };
}

async function auditActors(orgId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("audit_log")
    .select("actor")
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.sent_sync_changed")
    .orderBy("id")
    .execute();
  return rows.map((row) => row.actor);
}

describe("mailbox:settings sent-sync", () => {
  test("1: on with the flag on: exit 0, sent sync on, state on, one audit row with actor cli; again: no change", async () => {
    const { ctx, args, box } = await setup({ flag: true });
    const result = await runSettings(args("on"));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("sent sync on");
    expect((await getSentSyncState(db, ctx, box.mailboxId))?.enabled).toBe(true);
    expect(await auditActors(ctx.orgId)).toEqual(["cli"]);
    const again = await runSettings(args("on"));
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("no change");
    expect(await auditActors(ctx.orgId)).toEqual(["cli"]);
  });

  test("2: off with 2 rows: exit 0, deleted 2 sent mails, no rows", async () => {
    const { ctx, args, box } = await setup({ flag: true, switchOn: true, rows: 2 });
    const result = await runSettings(args("off"));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("sent sync off");
    expect(result.stdout).toContain("deleted 2 sent mails");
    const left = await db.selectFrom("sent_emails").select("id").where("mailbox_id", "=", box.mailboxId).execute();
    expect(left).toHaveLength(0);
    expect(await auditActors(ctx.orgId)).toEqual(["cli"]);
  });

  test("3: flag off: on exits 1 and names the flag; off on an enabled row exits 0", async () => {
    const { ctx, args, box } = await setup({ flag: false });
    const refused = await runSettings(args("on"));
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("sent_sync");
    expect(refused.stderr).toContain("org:flag");
    expect(await getSentSyncState(db, ctx, box.mailboxId)).toBeUndefined();

    const enabled = await setup({ flag: false, switchOn: true });
    const off = await runSettings(enabled.args("off"));
    expect(off.code).toBe(0);
    expect((await getSentSyncState(db, enabled.ctx, enabled.box.mailboxId))?.enabled).toBe(false);
  });

  test("4: a mailbox of another organization exits 1 and changes nothing", async () => {
    const mine = await setup({ flag: true, switchOn: true, rows: 1 });
    const other = await setup({ flag: true });
    const res = await runSettings([
      "sent-sync",
      "--org-id",
      other.box.orgId,
      "--mailbox-id",
      mine.box.mailboxId,
      "--value",
      "off",
    ]);
    expect(res.code).toBe(1);
    expect((await getSentSyncState(db, mine.ctx, mine.box.mailboxId))?.enabled).toBe(true);
    const rows = await db.selectFrom("sent_emails").select("id").where("mailbox_id", "=", mine.box.mailboxId).execute();
    expect(rows).toHaveLength(1);
    expect(await auditActors(other.ctx.orgId)).toEqual([]);
  });

  test("5: show prints the sent: line", async () => {
    const off = await setup({ flag: false });
    const hidden = await runSettings(["show", "--org-id", off.box.orgId, "--mailbox-id", off.box.mailboxId]);
    expect(hidden.code).toBe(0);
    expect(hidden.stdout).toContain("sent: off (flag)");

    const on = await setup({ flag: true, switchOn: true, rows: 1 });
    await setFolderMapEntry(db, on.ctx, on.box.mailboxId, "sent", "Sent");
    await db
      .updateTable("mailbox_sent_sync")
      .set({ path: "Sent" })
      .where("org_id", "=", on.ctx.orgId)
      .where("mailbox_id", "=", on.box.mailboxId)
      .execute();
    const shown = await runSettings(["show", "--org-id", on.box.orgId, "--mailbox-id", on.box.mailboxId]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(
      `sent: on, folder Sent, stored 1, last ${new Date(AT.getTime() - DAY_MS).toISOString()}, first pass pending, error none`
    );
  });

  test("6: a random mailbox id of the same organization exits 1", async () => {
    const { box } = await setup({ flag: true });
    const res = await runSettings(["sent-sync", "--org-id", box.orgId, "--mailbox-id", randomUUID(), "--value", "off"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("no such mailbox");
  });
});
