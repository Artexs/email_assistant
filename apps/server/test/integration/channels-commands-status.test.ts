import { randomUUID } from "node:crypto";

import { HOUR_MS, textTables } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { recordLlmCall } from "../../src/modules/audit";
import { helpMessage, statusMessage, type LinkedChat } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { insertMailbox } from "../../src/modules/mail/repo";
import { setDigestTimes, setOrgFeature } from "../../src/modules/tenancy";

import { MIN, T, at, depsAt, llmCall, setup, utc } from "./channels-commands-helpers";
import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  testCapabilities,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("helpMessage", () => {
  test("is the help text without buttons", () => {
    const helpLink: LinkedChat = {
      orgId: randomUUID(),
      userId: randomUUID(),
      role: "owner",
      chatId: 1,
      linkedAt: new Date(0),
      locale: "en",
    };
    expect(helpMessage(helpLink)).toEqual({ text: textTables.en.bot.help, buttons: [] });
  });

  test("has the Undo line", () => {
    expect(textTables.en.bot.help).toContain(
      "↩️ under a digest line undoes what the system did to that mail (7 days)."
    );
    expect(textTables.en.bot.help).toContain(
      "📤 under an approval sends the draft; ✖️ rejects it (the draft is removed)."
    );
    expect(textTables.en.bot.help).toContain("✅ Done under an answered delegation closes it.");
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
      await insertTestEmail(trx, ctx, a.mailboxId, { status: "pending", received_at: at(-HOUR_MS) });

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.buttons).toEqual([]);
      expect(message.text).toStartWith("📊 Status · Fri 6 Nov 11:00");
      expect(message.text).toContain(`📮 ${address}`);
      expect(message.text).toContain("Mode: shadow · Status: active");
      expect(message.text).toContain("Last sync: 10:55\n");
      expect(message.text).not.toContain("(late)");
      expect(message.text).toContain("LLM calls since 09:00: 3 of 300");
      expect(message.text).toContain("Waiting for triage: 1");
      expect(message.text).toContain("Triage: real mail of every active mailbox (TRIAGE_LLM_SCOPE=all)");
      expect(message.text).not.toContain("test mailbox");
      expect(message.text).toContain("LLM: gemini · gemini-3.5-flash-lite");
      expect(message.text).toContain("Next digest: 16:00");
      expect(message.text).toContain("Quiet hours: 22:00–07:00 (notices wait until 07:00)");
    });
  });

  test("the quiet hours line shows the own hours of the member (flag user_quiet_hours), the default otherwise (F110 s18)", async () => {
    await withRollback(db, async (trx) => {
      const { a, ctx, link } = await setup(trx);
      const own = (start: string | null, end: string | null) =>
        trx
          .updateTable("memberships")
          .set({ quiet_start: start, quiet_end: end })
          .where("org_id", "=", a.orgId)
          .where("user_id", "=", a.userId)
          .execute();
      await own("23:00", "06:00");
      // Flag off: the default for everyone.
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain(
        "Quiet hours: 22:00–07:00 (notices wait until 07:00)"
      );
      await setOrgFeature(trx, ctx, { flag: "user_quiet_hours", enabled: true, actor: "cli", now: T });
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain(
        "Quiet hours: 23:00–06:00 (notices wait until 06:00)"
      );
      const pl = (await statusMessage(depsAt(trx, T), { ...link, locale: "pl" })).text;
      expect(pl).toContain("Godziny ciszy: 23:00–06:00 (komunikaty czekają do 06:00)");
      await own("10:00", "10:00");
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain("Quiet hours: none");
      await own(null, null);
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain(
        "Quiet hours: 22:00–07:00 (notices wait until 07:00)"
      );
    });
  });

  test("the actions line shows the scope and the counts of the last 24 h", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, link, a } = await setup(trx);
      const off = await statusMessage(depsAt(trx, T), link);
      expect(off.text).toContain("Actions: off · last 24 h: applied 0, undone 0, failed 0");

      const emailId = await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: at(-2 * HOUR_MS) });
      await insertAction(trx, ctx, emailId, { type: "mark_read", status: "applied", appliedAt: at(-HOUR_MS) });
      await insertAction(trx, ctx, emailId, { type: "flag", status: "applied", appliedAt: at(-2 * HOUR_MS) });
      await insertAction(trx, ctx, emailId, { type: "move", status: "failed", createdAt: at(-HOUR_MS) });
      await insertAction(trx, ctx, emailId, { type: "save_summary", status: "applied", appliedAt: at(-HOUR_MS) });
      await insertAction(trx, ctx, emailId, { type: "flag", status: "applied", appliedAt: at(-30 * HOUR_MS) });

      const all = await statusMessage(depsAt(trx, T, { actionsScope: { kind: "all" } }), link);
      expect(all.text).toContain(
        "Actions: real mail, by the mode of each mailbox (ACTIONS_SCOPE=all) · last 24 h: applied 2, undone 0, failed 1"
      );
      const synthetic = await statusMessage(
        depsAt(trx, T, { actionsScope: { kind: "synthetic", testMail: NO_TEST_SENDERS } }),
        link
      );
      expect(synthetic.text).toContain("Actions: test mail only (ACTIONS_SCOPE=synthetic) · last 24 h: applied 2");
    });
  });

  test("status shows approvals, the send scope and the delegations", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, link, a } = await setup(trx);
      const empty = await statusMessage(depsAt(trx, T), link);
      expect(empty.text).toContain("Approvals: 0 waiting for your tap");
      expect(empty.text).toContain("Send: off");
      expect(empty.text).toContain("Delegations: 0 waiting for a reply, 0 overdue");

      await insertDraftAndSend(trx, ctx, a.mailboxId, { notifiedAt: at(-2 * HOUR_MS), createdAt: at(-3 * HOUR_MS) });
      await insertDraftAndSend(trx, ctx, a.mailboxId, {
        sendStatus: "approved",
        approved: { userId: a.userId, at: at(-HOUR_MS) },
        createdAt: at(-3 * HOUR_MS),
      });
      const off = await statusMessage(depsAt(trx, T), link);
      expect(off.text).toContain(
        "Approvals: 1 waiting for your tap (oldest 09:00) · 1 approved, held by SEND_SCOPE=off"
      );

      const self = await statusMessage(depsAt(trx, T, { sendScope: { kind: "self", addresses: ["me@x.test"] } }), link);
      expect(self.text).toContain("Send: only to your test addresses (SEND_SCOPE=self)");
      expect(self.text).toContain("1 approved, held by SEND_SCOPE=self");

      const all = await statusMessage(depsAt(trx, T, { sendScope: { kind: "all" } }), link);
      expect(all.text).toContain("Send: real recipients, after an owner's tap (SEND_SCOPE=all)");
      expect(all.text).toContain("1 approved, sending");

      await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", a.mailboxId).execute();
      const paused = await statusMessage(depsAt(trx, T, { sendScope: { kind: "all" } }), link);
      expect(paused.text).toContain("1 approved, held: the mailbox is paused");
      await trx.updateTable("mailboxes").set({ status: "auth_error" }).where("id", "=", a.mailboxId).execute();
      const broken = await statusMessage(depsAt(trx, T), link);
      expect(broken.text).toContain("1 approved, held: the mailbox login fails");
      // The mailbox state comes before the scope: scope off and auth_error names the login.
      expect(broken.text).not.toContain("SEND_SCOPE=off");
      await trx.updateTable("mailboxes").set({ status: "host_blocked" }).where("id", "=", a.mailboxId).execute();
      const blocked = await statusMessage(depsAt(trx, T), link);
      expect(blocked.text).toContain("1 approved, held: the mail server is not allowed");
      expect(blocked.text).not.toContain("SEND_SCOPE=off");
    });
  });

  test("status counts the open delegations", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, link, a } = await setup(trx);
      const delegateId = await insertDelegate(trx, ctx);
      for (const status of ["sent", "sent", "overdue", "done"]) {
        const row = await insertDraftAndSend(trx, ctx, a.mailboxId, {
          sendStatus: "applied",
          approved: { userId: a.userId, at: at(-HOUR_MS) },
          createdAt: at(-3 * HOUR_MS),
        });
        await insertDelegation(trx, ctx, {
          mailboxId: a.mailboxId,
          emailId: row.emailId,
          delegateId,
          draftActionId: row.draftId,
          sendActionId: row.sendId,
          status,
        });
      }
      const text = (await statusMessage(depsAt(trx, T), link)).text;
      expect(text).toContain("Delegations: 2 waiting for a reply, 1 overdue");
    });
  });

  test("status shows one approvals line per mailbox when there are two", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, link, a } = await setup(trx);
      const second = randomUUID();
      await insertMailbox(trx, ctx, {
        id: second,
        address: `second-${second}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertDraftAndSend(trx, ctx, a.mailboxId, { notifiedAt: at(-2 * HOUR_MS), createdAt: at(-3 * HOUR_MS) });
      const lines = (await statusMessage(depsAt(trx, T), link)).text
        .split("\n")
        .filter((line) => line.startsWith("Approvals"));
      expect(lines).toHaveLength(2);
      expect(lines.filter((line) => line.includes("1 waiting for your tap"))).toHaveLength(1);
      expect(lines.filter((line) => line.includes("0 waiting for your tap"))).toHaveLength(1);
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

      await setBox({ status: "host_blocked", status_changed_at: utc("2026-11-06T09:40:00Z") });
      expect((await statusMessage(depsAt(trx, T), link)).text).toContain(
        "Status: mail server not allowed since 10:40 (checked again at each sync)"
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
      await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId, { status: "pending", received_at: at(-HOUR_MS) });

      const message = await statusMessage(depsAt(trx, T), link);

      expect(message.text).toContain(address);
      expect(message.text).not.toContain("other-org-box@x.test");
      expect(message.text).toContain("LLM calls since 09:00: 0 of 300");
      expect(message.text).toContain("Waiting for triage: 0");
    });
  });

  test("the LLM pause line follows the flag llm_pause_line, after the LLM line", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      const row = (outcome: string, when: Date) =>
        recordLlmCall(
          trx,
          { orgId: a.orgId },
          {
            mailboxId: a.mailboxId,
            role: "classifier",
            promptVersion: "test",
            model: "gemini-3.5-flash-lite",
            endpoint: "standard",
            provider: "openai" as const,
            outcome,
            tokensIn: null,
            tokensOut: null,
            latencyMs: 5,
            at: when,
          }
        );
      await row("ok", at(-20 * MIN));
      await row("http_429_quota", at(-10 * MIN));
      await row("http_429_quota", at(-5 * MIN));

      const off = await statusMessage(depsAt(trx, T), link);
      expect(off.text).not.toContain("LLM paused");

      await setOrgFeature(trx, { orgId: a.orgId }, { flag: "llm_pause_line", enabled: true, actor: "cli", now: T });
      const on = (await statusMessage(depsAt(trx, T), link)).text.split("\n");
      const llmAt = on.indexOf("LLM: gemini · gemini-3.5-flash-lite");
      expect(llmAt).toBeGreaterThan(-1);
      expect(on[llmAt + 1]).toBe(
        "⏸ LLM paused since 10:50: the provider quota or budget is spent (http_429_quota). Triage waits."
      );

      await row("ok", at(-2 * MIN));
      expect((await statusMessage(depsAt(trx, T), link)).text).not.toContain("LLM paused");
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
