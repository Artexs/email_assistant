import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { HOUR_MS, textTables } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import {
  createUpdateHandlers,
  digestNowMessage,
  helpMessage,
  pauseMailboxes,
  resumeMailboxes,
  runCommand,
  statusMessage,
  type LinkedChat,
} from "../../src/modules/channels";
import { insertMailbox, listSyncTargets, setMailboxStatus } from "../../src/modules/mail/repo";
import { insertDigest, markDigestSent } from "../../src/modules/reports";
import type { DB } from "../../src/platform/db";

import { MIN, T, at, depsAt, setup } from "./channels-commands-helpers";
import { createOrgWithMailbox, insertTriaged, suspendOrg, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("digestNowMessage", () => {
  test("the header, a result in the period and no digests row", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "urgent",
        createdAt: at(-HOUR_MS),
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
        periodStart: at(-12 * HOUR_MS),
        periodEnd: at(-2 * HOUR_MS),
      });
      await markDigestSent(trx, ctx, id as string, at(-2 * HOUR_MS));
      await insertTriaged(trx, ctx, a.mailboxId, {
        category: "info",
        createdAt: at(-3 * HOUR_MS),
        subject: "MARKER-OLD",
      });
      await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-HOUR_MS), subject: "MARKER-NEW" });

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

      const resumed = await resumeMailboxes(depsAt(trx, at(2 * MIN), { syncEveryMin: 3 }), link);
      expect(resumed.text).toStartWith(`▶️ Resumed: ${address}\n`);
      expect(resumed.text).toContain("The next sync runs within 3 minutes.");
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

  test("an OAuth mailbox in auth_error: pause and resume point to Reconnect, /status too", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link, address } = await setup(trx);
      await trx
        .updateTable("mailboxes")
        .set({
          oauth_provider: "google",
          status: "auth_error",
          auth_reason: "oauth_expired",
          status_changed_at: at(-MIN),
        })
        .where("id", "=", a.mailboxId)
        .execute();

      for (const command of [pauseMailboxes, resumeMailboxes]) {
        const reply = await command(depsAt(trx, T), link);
        expect(reply.text).toBe(`❌ ${address} has a sign-in error: tap Reconnect in the panel first.`);
      }
      const status = (await statusMessage(depsAt(trx, T), link)).text;
      expect(status).toContain("sign-in error since 10:59 (Reconnect in the panel)");
      expect(status).not.toContain("mailbox:password");
      const pl = await pauseMailboxes(depsAt(trx, T), { ...link, locale: "pl" });
      expect(pl.text).toBe(`❌ ${address} ma błąd logowania: najpierw stuknij „Połącz ponownie” w panelu.`);
      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("auth_error");

      // A second organization with a password mailbox in auth_error keeps today's texts.
      const other = await createOrgWithMailbox(trx);
      await setMailboxStatus(trx, { orgId: other.orgId }, other.mailboxId, "auth_error", at(-MIN));
      const otherLink: LinkedChat = { ...link, orgId: other.orgId, userId: other.userId };
      const otherReply = await pauseMailboxes(depsAt(trx, T), otherLink);
      expect(otherReply.text).toContain("run mailbox:password first.");
      expect(ctx.orgId).not.toBe(other.orgId);
    });
  });

  test("an OAuth mailbox in auth_error with no reason: the same Reconnect texts for pause, resume and /status", async () => {
    await withRollback(db, async (trx) => {
      const { a, link, address } = await setup(trx);
      await trx
        .updateTable("mailboxes")
        .set({ oauth_provider: "microsoft", status: "auth_error", auth_reason: null, status_changed_at: at(-MIN) })
        .where("id", "=", a.mailboxId)
        .execute();

      for (const command of [pauseMailboxes, resumeMailboxes]) {
        const reply = await command(depsAt(trx, T), link);
        expect(reply.text).toBe(`❌ ${address} has a sign-in error: tap Reconnect in the panel first.`);
      }
      const status = (await statusMessage(depsAt(trx, T), link)).text;
      expect(status).toContain("sign-in error since 10:59 (Reconnect in the panel)");
      expect(status).not.toContain("mailbox:password");
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

  test("a host_blocked mailbox stays host_blocked and the active one changes", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link, address } = await setup(trx);
      const otherId = randomUUID();
      await insertMailbox(trx, ctx, {
        id: otherId,
        address: "blocked-box@x.test",
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      await setMailboxStatus(trx, ctx, otherId, "host_blocked", at(-MIN));
      const skip = "⛔ blocked-box@x.test: its mail server is not allowed; the system checks it again at each sync.";

      const paused = await pauseMailboxes(depsAt(trx, T), link);
      expect(paused.text).toContain(`⏸ Paused: ${address}\n`);
      expect(paused.text).toContain(skip);
      const resumed = await resumeMailboxes(depsAt(trx, at(MIN)), link);
      expect(resumed.text).toContain(skip);

      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("active");
      const row = await mailboxRow(trx, otherId);
      expect(row.status).toBe("host_blocked");
      expect(row.status_changed_at).toEqual(at(-MIN));
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toHaveLength(1);
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

describe("commands of a suspended organization", () => {
  const CONTACT = "ops@example.test";
  const mailboxRow = (trx: Transaction<DB>, id: string) =>
    trx.selectFrom("mailboxes").select("status").where("id", "=", id).executeTakeFirstOrThrow();
  const auditRows = (trx: Transaction<DB>, orgId: string, event: string) =>
    trx.selectFrom("audit_log").select("id").where("org_id", "=", orgId).where("event", "=", event).execute();

  test("every command except /help answers paused and changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await suspendOrg(trx, a.orgId);
      const handlers = createUpdateHandlers(depsAt(trx, T, { operatorContact: CONTACT }));

      for (const name of ["digest", "status", "pause", "resume"] as const) {
        expect(await handlers.command(link, name)).toEqual({
          text: textTables.en.bot.accountPaused(CONTACT),
          buttons: [],
        });
      }
      expect((await handlers.command(link, "pause")).text).toEndWith(`contact ${CONTACT}.`);
      expect((await mailboxRow(trx, a.mailboxId)).status).toBe("active");
      expect(await auditRows(trx, a.orgId, auditEvents.mailboxPaused)).toEqual([]);
      expect(await handlers.command(link, "help")).toEqual(helpMessage(link));
    });
  });

  test("a refused command and a refused tap each log one event with the organization id and the command name", async () => {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(format(...args)));
    try {
      await withRollback(db, async (trx) => {
        const { a, link } = await setup(trx);
        await suspendOrg(trx, a.orgId);
        const handlers = createUpdateHandlers(depsAt(trx, T, { operatorContact: CONTACT }));

        await handlers.command(link, "digest");
        await handlers.command(link, "help");
        await handlers.callback(link, `ap:${randomUUID()}`);

        expect(lines).toEqual([
          `[channels] command_refused_suspended org_id=${a.orgId} command=digest`,
          `[channels] tap_refused_suspended org_id=${a.orgId}`,
        ]);
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  test("without a contact the text names the operator", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await suspendOrg(trx, a.orgId);
      const handlers = createUpdateHandlers(depsAt(trx, T));

      expect((await handlers.command(link, "status")).text).toBe(
        "⏸ This account is paused. Nothing changes now. To resume it, contact the operator."
      );
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

      expect(await handlers.command(link, "help")).toEqual(helpMessage(link));
      expect(await handlers.callback(link, `fx:${randomUUID()}`)).toEqual({
        answer: "",
        edit: { text: "✏️ Cancelled.", buttons: [] },
      });
    });
  });
});
