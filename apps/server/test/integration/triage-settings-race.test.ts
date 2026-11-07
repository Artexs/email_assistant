import { afterAll, describe, expect, test } from "bun:test";

import { expireReady, listActionsForEmail } from "../../src/modules/actions";
import { getMailboxSettings, insertDefaultSettings, setToolSwitch, type SettingsDeps } from "../../src/modules/config";
import { claimEmails } from "../../src/modules/mail";
import { saveTriage, type TriageDecision, type TriageMailbox } from "../../src/modules/triage";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-07T12:00:00Z");

const decision: TriageDecision = {
  finalCategory: "info",
  modelCategory: "info",
  confidence: 0.9,
  reasonCode: "newsletter",
  reason: null,
  summary: "short summary",
  fields: {},
  vip: false,
  model: "m",
  promptVersion: "classifier-v1",
  usage: null,
  auditReasonCode: "newsletter",
};

// Own org, committed: the setter and the writer run on separate connections. The caller cleans up.
async function committedSetup() {
  const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
  const ctx = { orgId: created.orgId };
  try {
    await insertDefaultSettings(db, ctx, created.mailboxId);
    await setToolSwitch({ db, now: () => now, expireReady }, ctx, created.mailboxId, {
      name: "move",
      value: true,
      actor: "test",
    });
    const emailId = await db.transaction().execute((trx) => insertTestEmail(trx, ctx, created.mailboxId));
    const [email] = await claimEmails(db, ctx, created.mailboxId, {
      now,
      limit: 10,
      staleBefore: new Date(now.getTime() - 5 * 60_000),
      syntheticOnly: false,
    });
    if (!email) throw new Error("claim failed");
    const settings = await getMailboxSettings(db, ctx, created.mailboxId);
    if (!settings) throw new Error("no settings");
    const mailbox: TriageMailbox = {
      id: created.mailboxId,
      settingsVersion: settings.version,
      mode: "assist",
      toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
      policy: { info: { auto: true } },
      rules: [],
      movesSupported: true,
    };
    return { created, ctx, emailId, email, mailbox };
  } catch (error) {
    await cleanup(created);
    throw error;
  }
}

async function cleanup(created: { orgId: string; userId: string }): Promise<void> {
  await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
  await db.deleteFrom("users").where("id", "=", created.userId).execute();
}

describe("saveTriage with changed settings", () => {
  test("a setter that commits after the snapshot: no action rows, mail free, no attempt counted", async () => {
    const s = await committedSetup();
    try {
      const deps: SettingsDeps = { db, now: () => now, expireReady };
      await setToolSwitch(deps, s.ctx, s.created.mailboxId, { name: "move", value: false, actor: "test" });

      expect(await saveTriage(db, s.ctx, s.mailbox, s.email, decision)).toEqual({ kind: "retry_later" });

      expect(await listActionsForEmail(db, s.ctx, s.emailId)).toEqual([]);
      const results = await db.selectFrom("triage_results").select("id").where("email_id", "=", s.emailId).execute();
      expect(results).toEqual([]);
      const row = await db
        .selectFrom("emails")
        .select(["status", "locked_at", "attempts"])
        .where("id", "=", s.emailId)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "pending", locked_at: null, attempts: s.email.attempts });
    } finally {
      await cleanup(s.created);
    }
  });

  test("unchanged settings: the rows are saved", async () => {
    const s = await committedSetup();
    try {
      expect(await saveTriage(db, s.ctx, s.mailbox, s.email, decision)).toEqual({ kind: "triaged" });
      const actions = await listActionsForEmail(db, s.ctx, s.emailId);
      expect(actions.map((a) => a.type).sort()).toEqual(["move", "save_summary"]);
    } finally {
      await cleanup(s.created);
    }
  });
});
