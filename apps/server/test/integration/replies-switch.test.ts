import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { expireReady, getSend, noDelegationHooks } from "../../src/modules/actions";
import {
  getSettingsView,
  insertDefaultSettings,
  OauthMailboxError,
  setMode,
  setToolSwitch,
  updateMailboxSettings,
  type SettingsDeps,
} from "../../src/modules/config";
import { mailboxHasUidplus } from "../../src/modules/mail";
import { noGateEvidence } from "../../src/modules/triage";
import { clearTrips } from "../../src/modules/trust";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { addReplyMail, CLEAN_ANSWER, fakeLlm, jobDeps, NOW, requestsOf, runJob, setupBox } from "./reply-job-fixtures";

// The switch `reply_drafts` through the service `setToolSwitch` (the route and the CLI both call it). Every
// test runs in a transaction that is rolled back. The route and the CLI are in replies-switch-route.test.ts and replies-switch-cli.test.ts.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The composition root wraps `expireReady` with the send close; this is the same wrap.
function settingsDeps(trx: Transaction<DB>): SettingsDeps {
  return {
    db: trx,
    now: () => NOW,
    gate: noGateEvidence,
    clearTrips,
    expireReady: async (t, c, filter, opts) =>
      expireReady(t, c, filter, {
        ...opts,
        sendClose: { hooks: noDelegationHooks, uidplus: await mailboxHasUidplus(t, c, filter.mailboxId) },
      }),
  };
}

async function newBox(trx: Transaction<DB>) {
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  return { ...box, ctx };
}

async function storedSwitches(trx: Transaction<DB>, mailboxId: string) {
  const row = await trx
    .selectFrom("mailbox_settings")
    .select("tool_switches")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return row.tool_switches as Record<string, unknown>;
}

async function switchAudits(trx: Transaction<DB>, orgId: string) {
  return trx
    .selectFrom("audit_log")
    .select(["data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.switch_changed")
    .execute();
}

describe("the switch reply_drafts (F115 stage 10 step 1)", () => {
  test("1. the owner sets it on and the value is stored; the settings version moves; the audit row names the switch", async () => {
    await withRollback(db, async (trx) => {
      const s = await newBox(trx);
      const deps = settingsDeps(trx);
      const before = await trx
        .selectFrom("mailbox_settings")
        .select("updated_at")
        .where("mailbox_id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();

      const result = await setToolSwitch(deps, s.ctx, s.mailboxId, {
        name: "reply_drafts",
        value: true,
        actor: s.userId,
      });

      expect(result).toMatchObject({ changed: true, expired: 0 });
      expect((await storedSwitches(trx, s.mailboxId)).reply_drafts).toBe(true);
      expect((await getSettingsView(deps, s.ctx, s.mailboxId)).toolSwitches.reply_drafts).toBe(true);
      const after = await trx
        .selectFrom("mailbox_settings")
        .select("updated_at")
        .where("mailbox_id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      // The version moves as for every other switch, so a running triage batch retries.
      expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(before.updated_at.getTime());
      expect(await switchAudits(trx, s.ctx.orgId)).toEqual([
        { data: { mailbox_id: s.mailboxId, field: "switch.reply_drafts", from: false, to: true } },
      ]);
    });
  });

  test("2. off closes the open reply sends as policy_changed in the same transaction, with their drafts; a delegation send stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await newBox(trx);
      const deps = settingsDeps(trx);
      await setToolSwitch(deps, s.ctx, s.mailboxId, { name: "reply_drafts", value: true, actor: s.userId });
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "assist" });
      const createdAt = new Date(NOW.getTime() - HOUR_MS);
      const replyA = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { kind: "reply", createdAt });
      const replyB = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { kind: "reply", createdAt });
      const delegation = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { kind: "delegation", createdAt });

      const result = await setToolSwitch(deps, s.ctx, s.mailboxId, {
        name: "reply_drafts",
        value: false,
        actor: s.userId,
      });

      expect(result).toMatchObject({ changed: true, expired: 2, closedGate: true });
      for (const reply of [replyA, replyB]) {
        expect(await getSend(trx, s.ctx, reply.sendId)).toMatchObject({
          status: "expired",
          status_reason: "policy_changed",
        });
      }
      expect((await getSend(trx, s.ctx, delegation.sendId))?.status).toBe("awaiting_approval");
      expect((await storedSwitches(trx, s.mailboxId)).reply_drafts).toBe(false);
    });
  });

  test("2b. the other gates keep the same independence: create_draft off leaves a reply send open, mode shadow closes it", async () => {
    await withRollback(db, async (trx) => {
      const s = await newBox(trx);
      const deps = settingsDeps(trx);
      await setToolSwitch(deps, s.ctx, s.mailboxId, { name: "reply_drafts", value: true, actor: s.userId });
      await setToolSwitch(deps, s.ctx, s.mailboxId, { name: "create_draft", value: true, actor: s.userId });
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "assist" });
      const createdAt = new Date(NOW.getTime() - HOUR_MS);
      const reply = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { kind: "reply", createdAt });
      const delegation = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { kind: "delegation", createdAt });

      const off = await setToolSwitch(deps, s.ctx, s.mailboxId, {
        name: "create_draft",
        value: false,
        actor: s.userId,
      });

      expect(off.expired).toBe(1);
      expect((await getSend(trx, s.ctx, delegation.sendId))?.status).toBe("expired");
      expect((await getSend(trx, s.ctx, reply.sendId))?.status).toBe("awaiting_approval");

      const shadow = await setMode(deps, s.ctx, s.mailboxId, { mode: "shadow", keepSwitches: true, actor: s.userId });

      expect(shadow.expired).toBe(1);
      expect(await getSend(trx, s.ctx, reply.sendId)).toMatchObject({
        status: "expired",
        status_reason: "policy_changed",
      });
    });
  });

  test("2c. an unchanged value closes nothing: reply_drafts off when it is already off", async () => {
    await withRollback(db, async (trx) => {
      const s = await newBox(trx);
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "assist" });
      const reply = await insertDraftAndSend(trx, s.ctx, s.mailboxId, { kind: "reply" });

      const result = await setToolSwitch(settingsDeps(trx), s.ctx, s.mailboxId, {
        name: "reply_drafts",
        value: false,
        actor: s.userId,
      });

      expect(result).toMatchObject({ changed: false, expired: 0 });
      expect((await getSend(trx, s.ctx, reply.sendId))?.status).toBe("awaiting_approval");
    });
  });

  test("3. create_draft false and reply_drafts true: the scan of the drafter makes a reply request and a draft", async () => {
    await withRollback(db, async (trx) => {
      const box = await setupBox(trx, { switchOn: false });
      const emailId = await addReplyMail(trx, box);
      const deps = settingsDeps(trx);
      await setToolSwitch(deps, box.ctx, box.mailboxId, { name: "reply_drafts", value: true, actor: box.userId });
      const settings = await getSettingsView(deps, box.ctx, box.mailboxId);
      expect(settings.toolSwitches).toMatchObject({ create_draft: false, reply_drafts: true });
      const { llm } = fakeLlm(() => CLEAN_ANSWER);

      const run = await runJob(jobDeps(trx, llm, { now: NOW }), box);

      expect(run).toMatchObject({ requested: 1, outcomes: { done: 1 } });
      const [request] = await requestsOf(trx, box);
      expect(request).toMatchObject({ email_id: emailId, status: "done", trigger: "auto" });
    });
  });

  test("4. a Microsoft OAuth mailbox: on is refused and nothing is stored (no audit row); off is stored", async () => {
    await withRollback(db, async (trx) => {
      const s = await newBox(trx);
      const deps = settingsDeps(trx);
      await trx.updateTable("mailboxes").set({ oauth_provider: "microsoft" }).where("id", "=", s.mailboxId).execute();
      const before = await trx
        .selectFrom("mailbox_settings")
        .select(["tool_switches", "updated_at"])
        .where("mailbox_id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();

      await expect(
        setToolSwitch(deps, s.ctx, s.mailboxId, { name: "reply_drafts", value: true, actor: s.userId })
      ).rejects.toBeInstanceOf(OauthMailboxError);

      const after = await trx
        .selectFrom("mailbox_settings")
        .select(["tool_switches", "updated_at"])
        .where("mailbox_id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(after.tool_switches).toEqual(before.tool_switches);
      expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
      expect(await switchAudits(trx, s.ctx.orgId)).toEqual([]);

      // Off is always accepted: a stored `true` (made before the guard, or by hand) can go off.
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: { ...(before.tool_switches as Record<string, unknown>), reply_drafts: true } })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const off = await setToolSwitch(deps, s.ctx, s.mailboxId, {
        name: "reply_drafts",
        value: false,
        actor: s.userId,
      });
      expect(off.changed).toBe(true);
      expect((await storedSwitches(trx, s.mailboxId)).reply_drafts).toBe(false);
    });
  });

  test("4b. the guard reads the mailbox of the organization: a mailbox of another organization is not found, and a Google mailbox is refused too", async () => {
    await withRollback(db, async (trx) => {
      const a = await newBox(trx);
      const b = await newBox(trx);
      const deps = settingsDeps(trx);
      await expect(
        setToolSwitch(deps, a.ctx, b.mailboxId, { name: "reply_drafts", value: true, actor: a.userId })
      ).rejects.toThrow("no mailbox_settings row");
      expect((await storedSwitches(trx, b.mailboxId)).reply_drafts).not.toBe(true);

      await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", a.mailboxId).execute();
      await expect(
        setToolSwitch(deps, a.ctx, a.mailboxId, { name: "reply_drafts", value: true, actor: a.userId })
      ).rejects.toBeInstanceOf(OauthMailboxError);
    });
  });
});
