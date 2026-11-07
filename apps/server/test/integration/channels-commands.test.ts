import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import {
  createUpdateHandlers,
  digestNowMessage,
  helpMessage,
  pauseMailboxes,
  resumeMailboxes,
  runCommand,
  statusMessage,
  type CommandDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import { helpText } from "../../src/modules/channels/texts";
import { insertDefaultSettings } from "../../src/modules/config";
import { insertMailbox, listSyncTargets, markSynced, setMailboxStatus } from "../../src/modules/mail/repo";
import { insertDigest, markDigestSent } from "../../src/modules/reports";
import { setDigestTimes } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTestEmail, insertTriaged, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// T is 11:00 in Warsaw (UTC+1 in November). The quota day (Los Angeles, UTC-8) started at 08:00Z = 09:00 local.
const T = new Date("2026-11-06T10:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const at = (offset: number) => new Date(T.getTime() + offset);
const utc = (iso: string) => new Date(iso);

function depsAt(trx: Transaction<DB>, now: Date, extra: Partial<CommandDeps> = {}): CommandDeps {
  return {
    db: trx,
    now: () => now,
    llmDailyCap: 300,
    triageScope: "all",
    actionsScope: { kind: "off" },
    llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
    ...extra,
  };
}

async function llmCall(trx: Transaction<DB>, orgId: string, mailboxId: string, when: Date): Promise<void> {
  await recordAudit(
    trx,
    { orgId },
    { actor: "system", event: auditEvents.llmCall, data: { mailbox_id: mailboxId }, at: when }
  );
}

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const ctx = { orgId: a.orgId };
  await insertDefaultSettings(trx, ctx, a.mailboxId);
  await markSynced(trx, ctx, a.mailboxId, utc("2026-11-06T09:55:00Z"));
  await setDigestTimes(trx, ctx, a.userId, ["08:00", "16:00"]);
  const address = await trx
    .selectFrom("mailboxes")
    .select("address")
    .where("id", "=", a.mailboxId)
    .executeTakeFirstOrThrow();
  const link: LinkedChat = {
    orgId: a.orgId,
    userId: a.userId,
    role: "owner",
    chatId: 1,
    linkedAt: at(-30 * 24 * HOUR),
  };
  return { a, ctx, link, address: address.address };
}

describe("helpMessage", () => {
  test("is the help text without buttons", () => {
    expect(helpMessage()).toEqual({ text: helpText(), buttons: [] });
  });

  test("has the Undo line", () => {
    expect(helpText()).toContain("↩️ under a digest line undoes what the system did to that mail (7 days).");
  });
});

describe("statusMessage", () => {
  test("the full status of one mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link, address } = await setup(trx);
      await llmCall(trx, a.orgId, a.mailboxId, utc("2026-11-06T08:30:00Z"));
      await llmCall(trx, a.orgId, a.mailboxId, utc("2026-11-06T09:00:00Z"));
      await llmCall(trx, a.orgId, a.mailboxId, utc("2026-11-06T09:30:00Z"));
      await llmCall(trx, a.orgId, a.mailboxId, utc("2026-11-06T07:59:00Z"));
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "pending", received_at: at(-HOUR) });

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.buttons).toEqual([]);
      expect(message.text).toStartWith("📊 Status · Fri 6 Nov 11:00");
      expect(message.text).toContain(`📮 ${address}`);
      expect(message.text).toContain("Mode: shadow · Status: active");
      expect(message.text).toContain("Last sync: 10:55\n");
      expect(message.text).not.toContain("(late)");
      expect(message.text).toContain("LLM calls since 09:00: 3 of 300");
      expect(message.text).toContain("Waiting for triage: 1");
      expect(message.text).toContain("Triage: real mail of the test mailbox (TRIAGE_LLM_SCOPE=all)");
      expect(message.text).toContain("LLM: gemini · gemini-3.5-flash-lite");
      expect(message.text).toContain("Next digest: 16:00");
      expect(message.text).toContain("Quiet hours: 22:00–07:00 (notices wait until 07:00)");
    });
  });

  test("the actions line shows the scope and the counts of the last 24 h", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, link, a, address } = await setup(trx);
      const off = await statusMessage(depsAt(trx, T), link);
      expect(off.text).toContain("Actions: off · last 24 h: applied 0, undone 0, failed 0");

      const emailId = await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-2 * HOUR) });
      await insertAction(trx, ctx, emailId, { type: "mark_read", status: "applied", appliedAt: at(-HOUR) });
      await insertAction(trx, ctx, emailId, { type: "flag", status: "applied", appliedAt: at(-2 * HOUR) });
      await insertAction(trx, ctx, emailId, { type: "move", status: "failed", createdAt: at(-HOUR) });
      await insertAction(trx, ctx, emailId, { type: "save_summary", status: "applied", appliedAt: at(-HOUR) });
      await insertAction(trx, ctx, emailId, { type: "flag", status: "applied", appliedAt: at(-30 * HOUR) });

      const all = await statusMessage(depsAt(trx, T, { actionsScope: { kind: "all", mailboxAddress: address } }), link);
      expect(all.text).toContain(
        "Actions: real mail of the test mailbox (ACTIONS_SCOPE=all) · last 24 h: applied 2, undone 0, failed 1"
      );
      const synthetic = await statusMessage(depsAt(trx, T, { actionsScope: { kind: "synthetic" } }), link);
      expect(synthetic.text).toContain("Actions: test mail only (ACTIONS_SCOPE=synthetic) · last 24 h: applied 2");
    });
  });

  test("status, late sync and never synced", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      const setBox = (patch: { status?: string; status_changed_at?: Date; last_synced_at?: Date | null }) =>
        trx.updateTable("mailboxes").set(patch).where("id", "=", a.mailboxId).execute();

      await setBox({ status: "paused", status_changed_at: utc("2026-11-05T13:00:00Z") });
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain("Status: paused since 5 Nov 14:00");

      await setBox({ status: "auth_error", status_changed_at: utc("2026-11-06T09:40:00Z") });
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain(
        "Status: login error since 10:40 (run mailbox:password)"
      );

      await setBox({ last_synced_at: utc("2026-11-06T09:20:00Z") });
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain("Last sync: 10:20 (late)");

      await setBox({ last_synced_at: null });
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain("Last sync: never");
    });
  });

  test("digest times and triage scope", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);

      await setDigestTimes(trx, ctx, a.userId, []);
      const none = await statusMessage(depsAt(trx, T, { triageScope: "off" }), link);
      expect(none.text).toContain("No digest times set (bun run digest:times)");
      expect(none.text).not.toContain("Next digest");
      expect(none.text).toContain("Triage: off\n");

      await setDigestTimes(trx, ctx, a.userId, ["08:00", "16:00"]);
      const late = await statusMessage(depsAt(trx, utc("2026-11-06T15:30:00Z"), { triageScope: "synthetic" }), link);
      expect(late.text).toContain("Next digest: 7 Nov 08:00");
      expect(late.text).toContain("Triage: test mail only (TRIAGE_LLM_SCOPE=synthetic)");
    });
  });

  test("data of another organization never shows", async () => {
    await withRollback(db, async (trx) => {
      const { a, link, address } = await setup(trx);
      const b = await createOrgWithMailbox(trx, { address: "other-org-box@x.test" });
      await insertDefaultSettings(trx, { orgId: b.orgId }, b.mailboxId);
      await llmCall(trx, b.orgId, b.mailboxId, at(-MIN));
      await llmCall(trx, b.orgId, a.mailboxId, at(-MIN));
      await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId, { status: "pending", received_at: at(-HOUR) });

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.text).toContain(address);
      expect(message.text).not.toContain("other-org-box@x.test");
      expect(message.text).toContain("LLM calls since 09:00: 0 of 300");
      expect(message.text).toContain("Waiting for triage: 0");
    });
  });

  test("a mailbox without settings is mode none", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await trx.deleteFrom("mailbox_settings").where("mailbox_id", "=", a.mailboxId).execute();

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.text).toContain("Mode: none (no settings row: not triaged)");
    });
  });

  test("no mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await trx.deleteFrom("mailboxes").where("id", "=", a.mailboxId).execute();

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.text).toContain("No mailbox connected.");
      expect(message.text).not.toContain("📮");
    });
  });

  test("10 mailboxes with 60-character addresses fit in one message", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      for (let index = 0; index < 9; index += 1) {
        await insertMailbox(trx, ctx, {
          id: randomUUID(),
          address: `${index}${"x".repeat(59)}`,
          imapHost: "imap.x.test",
          imapPort: 993,
          smtpHost: "smtp.x.test",
          smtpPort: 465,
          capabilities: testCapabilities,
          folderMap: { drafts: "Drafts" },
        });
      }
      await trx
        .updateTable("mailboxes")
        .set({ address: `z${"x".repeat(59)}` })
        .where("id", "=", a.mailboxId)
        .execute();
      await trx
        .updateTable("mailboxes")
        .set({ status: "auth_error", status_changed_at: utc("2026-11-05T13:00:00Z") })
        .where("org_id", "=", a.orgId)
        .execute();

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.text.split("📮")).toHaveLength(11);
      expect(message.text.length).toBeLessThanOrEqual(4096);
    });
  });
});

describe("digestNowMessage", () => {
  test("the header, a result in the period and no digests row", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-HOUR),
        subject: "MARKER-SUBJECT",
      });
      const count = async () =>
        Number(
          (
            await trx
              .selectFrom("digests")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .where("org_id", "=", a.orgId)
              .executeTakeFirstOrThrow()
          ).count
        );
      const before = await count();

      const message = await digestNowMessage(depsAt(trx, T), link);

      expect(message.text).toStartWith("📬 Digest now · Fri 6 Nov 11:00");
      expect(message.text).toContain("MARKER-SUBJECT");
      expect(message.buttons.length).toBeGreaterThan(0);
      expect(await count()).toBe(before);
      const outbox = await trx.selectFrom("outbox").select("id").where("org_id", "=", a.orgId).execute();
      expect(outbox).toEqual([]);
    });
  });

  test("the period starts at the end of the last sent digest", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      const id = await insertDigest(trx, ctx, {
        userId: a.userId,
        slotKey: "2026-11-06T08:00",
        periodStart: at(-12 * HOUR),
        periodEnd: at(-2 * HOUR),
      });
      await markDigestSent(trx, ctx, id as string, at(-2 * HOUR));
      await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-3 * HOUR), subject: "MARKER-OLD" });
      await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-HOUR), subject: "MARKER-NEW" });

      const message = await digestNowMessage(depsAt(trx, T), link);

      expect(message.text).toContain("MARKER-NEW");
      expect(message.text).not.toContain("MARKER-OLD");
    });
  });
});

describe("pauseMailboxes and resumeMailboxes", () => {
  const mailboxRow = (trx: Transaction<DB>, id: string) =>
    trx.selectFrom("mailboxes").select(["status", "status_changed_at"]).where("id", "=", id).executeTakeFirstOrThrow();
  const auditRows = (trx: Transaction<DB>, orgId: string, event: string) =>
    trx
      .selectFrom("audit_log")
      .select(["actor", "data"])
      .where("org_id", "=", orgId)
      .where("event", "=", event)
      .execute();
  const isTarget = async (trx: Transaction<DB>, mailboxId: string) =>
    (await listSyncTargets(trx)).some((target) => target.mailboxId === mailboxId);

  test("pause, pause again, resume", async () => {
    await withRollback(db, async (trx) => {
      const { a, link, address } = await setup(trx);

      const paused = await pauseMailboxes(depsAt(trx, T), link);
      expect(paused.text).toStartWith(`⏸ Paused: ${address}\n`);
      expect(paused.buttons).toEqual([]);
      const row = await mailboxRow(trx, a.mailboxId);
      expect(row.status).toBe("paused");
      expect(row.status_changed_at).toEqual(T);
      const events = await auditRows(trx, a.orgId, auditEvents.mailboxPaused);
      expect(events).toHaveLength(1);
      expect(events[0]?.actor).toBe(a.userId);
      expect(events[0]?.data).toEqual({ mailbox_id: a.mailboxId, via: "telegram" });
      expect(await isTarget(trx, a.mailboxId)).toBe(false);

      const again = await pauseMailboxes(depsAt(trx, at(MIN)), link);
      expect(again.text).toBe(`${address} was paused already.`);
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toHaveLength(1);

      const resumed = await resumeMailboxes(depsAt(trx, at(2 * MIN)), link);
      expect(resumed.text).toStartWith(`▶️ Resumed: ${address}\n`);
      const back = await mailboxRow(trx, a.mailboxId);
      expect(back.status).toBe("active");
      expect(back.status_changed_at).toEqual(at(2 * MIN));
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxResumed)).toHaveLength(1);
      expect(await isTarget(trx, a.mailboxId)).toBe(true);

      const already = await resumeMailboxes(depsAt(trx, at(3 * MIN)), link);
      expect(already.text).toBe(`${address} was active already.`);
    });
  });

  test("an auth_error mailbox stays auth_error", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link, address } = await setup(trx);
      await setMailboxStatus(trx, ctx, a.mailboxId, "auth_error", at(-MIN));

      for (const command of [pauseMailboxes, resumeMailboxes]) {
        const reply = await command(depsAt(trx, T), link);
        expect(reply.text).toBe(`❌ ${address} has a login error: run mailbox:password first.`);
      }
      const row = await mailboxRow(trx, a.mailboxId);
      expect(row.status).toBe("auth_error");
      expect(row.status_changed_at).toEqual(at(-MIN));
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toEqual([]);
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxResumed)).toEqual([]);
    });
  });

  test("an assistant gets the owner-only text and nothing changes", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      const assistant: LinkedChat = { ...link, role: "assistant" };

      for (const command of [pauseMailboxes, resumeMailboxes]) {
        expect(await command(depsAt(trx, T), assistant)).toEqual({
          text: "Only the owner can pause or resume the mailboxes.",
          buttons: [],
        });
      }
      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("active");
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toEqual([]);
    });
  });

  test("an auth_error from the sync job after a pause wins over /resume", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await pauseMailboxes(depsAt(trx, T), link);
      await setMailboxStatus(trx, ctx, a.mailboxId, "auth_error", at(MIN));

      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("auth_error");
      const reply = await resumeMailboxes(depsAt(trx, at(2 * MIN)), link);
      expect(reply.text).toStartWith("❌ ");
      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("auth_error");
    });
  });

  test("only the active mailbox of two changes", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link, address } = await setup(trx);
      const otherId = randomUUID();
      await insertMailbox(trx, ctx, {
        id: otherId,
        address: "second-box@x.test",
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await setMailboxStatus(trx, ctx, otherId, "auth_error", at(-MIN));

      const reply = await pauseMailboxes(depsAt(trx, T), link);

      expect(reply.text).toContain(`⏸ Paused: ${address}\n`);
      expect(reply.text).toContain("❌ second-box@x.test has a login error: run mailbox:password first.");
      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("paused");
      expect((await mailboxRow(trx, otherId)).status).toBe("auth_error");
    });
  });

  test("no mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await trx.deleteFrom("mailboxes").where("id", "=", a.mailboxId).execute();

      expect((await pauseMailboxes(depsAt(trx, T), link)).text).toBe("No mailbox connected.");
      expect((await resumeMailboxes(depsAt(trx, T), link)).text).toBe("No mailbox connected.");
    });
  });

  test("another organization is not touched", async () => {
    await withRollback(db, async (trx) => {
      const { link } = await setup(trx);
      const b = await createOrgWithMailbox(trx);

      await pauseMailboxes(depsAt(trx, T), link);

      expect((await mailboxRow(trx, b.mailboxId)).status).toBe("active");
      expect(await auditRows(trx, b.orgId, auditEvents.mailboxPaused)).toEqual([]);
    });
  });
});

describe("runCommand and createUpdateHandlers", () => {
  test("each command name gives its reply", async () => {
    await withRollback(db, async (trx) => {
      const { link } = await setup(trx);
      const deps = depsAt(trx, T);
      const first = async (name: Parameters<typeof runCommand>[2]) =>
        (await runCommand(deps, link, name)).text.split("\n")[0];

      expect(await first("help")).toBe("Commands:");
      expect(await first("status")).toStartWith("📊 Status");
      expect(await first("digest")).toStartWith("📬 Digest now");
      expect(await first("pause")).toStartWith("⏸ Paused");
      expect(await first("resume")).toStartWith("▶️ Resumed");
      expect(await first("resume")).toEndWith("was active already.");
    });
  });

  test("the handlers route a command and a callback", async () => {
    await withRollback(db, async (trx) => {
      const { link } = await setup(trx);
      const handlers = createUpdateHandlers(depsAt(trx, T));

      expect(await handlers.command(link, "help")).toEqual(helpMessage());
      expect(await handlers.callback(link, `fx:${randomUUID()}`)).toEqual({
        answer: "",
        edit: { text: "✏️ Cancelled.", buttons: [] },
      });
    });
  });
});
