import { format } from "node:util";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { ensureSyncFolders } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";

import { at, Org, org, rows, run, setStatus, T } from "./channels-notices-helpers";
import {
  insertAttachmentHeaders,
  insertTriaged,
  insertTriagedWithActions,
  isolateChannels,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorLines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorLines = [];
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("urgent notices", () => {
  test("a suspended organization gets no row; the active one does", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      await suspendOrg(trx, b.orgId);
      for (const o of [a, b]) {
        await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      }

      await run(trx);

      expect(await rows(trx, a.orgId, "urgent")).toHaveLength(2);
      expect(await rows(trx, b.orgId)).toEqual([]);
    });
  });

  test("every linked member gets one row per urgent mail; a repeat adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });
      await trx
        .insertInto("actions")
        .values({
          org_id: o.orgId,
          email_id: emailId,
          type: "flag",
          status: "logged",
          payload: JSON.stringify({}),
          idempotency_key: `k-${emailId}`,
        })
        .execute();

      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found).toHaveLength(2);
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.assistantId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`urgent:${emailId}`);
        expect(row.email_id).toBe(emailId);
        expect(row.text).toContain("🔴 Urgent mail");
        expect(row.text).toContain("→ would flag");
        expect(JSON.stringify(row.buttons)).toContain(`fr:u:${emailId}`);
        expect(JSON.stringify(row.buttons)).toContain(`fe:${emailId}`);
      }

      await run(trx);
      expect(await rows(trx, o.orgId, "urgent")).toHaveLength(2);
    });
  });

  test("the urgent view holds the suspicious codes only while the flag is on (flag off: no field), and only of its own organization", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const on = await org(trx);
      const off = await org(trx);
      const other = await org(trx);
      await setOrgFeature(trx, on.ctx, { flag: "suspicious_mail", enabled: true, actor: "cli", now: T });
      await setOrgFeature(trx, other.ctx, { flag: "suspicious_mail", enabled: true, actor: "cli", now: T });
      const flagged = (o: Org, reasons: string[]) =>
        insertTriaged(trx, o.ctx, o.mailboxId, {
          category: "urgent",
          createdAt: at(-10 * MINUTE_MS),
          suspiciousReasons: reasons,
        });
      const onId = await flagged(on, ["lookalike_domain", "risky_attachment"]);
      const offId = await flagged(off, ["lookalike_domain"]);
      const cleanId = await flagged(other, []);

      await run(trx);

      const onRows = await rows(trx, on.orgId, "urgent");
      expect(onRows).toHaveLength(2);
      for (const row of onRows) {
        expect(row.email_id).toBe(onId);
        expect((row.view as { suspicious?: string[] }).suspicious).toEqual(["lookalike_domain", "risky_attachment"]);
        // The whole line: nothing but the fixed phrases of the codes (no sender, no domain, no subject).
        expect(row.text.split("\n").filter((line) => line.startsWith("⚠"))).toEqual([
          "⚠ Suspicious: look-alike domain, risky attachment",
        ]);
      }
      for (const row of await rows(trx, off.orgId, "urgent")) {
        expect(row.email_id).toBe(offId);
        // No field at all: a view without it also renders in the code from before the field existed (rollback safety).
        expect("suspicious" in (row.view as object)).toBe(false);
        expect(row.text).not.toContain("⚠");
      }
      for (const row of await rows(trx, other.orgId, "urgent")) {
        expect(row.email_id).toBe(cleanId);
        // No field at all: a view without it also renders in the code from before the field existed (rollback safety).
        expect("suspicious" in (row.view as object)).toBe(false);
        expect(row.text).not.toContain("⚠");
      }
    });
  });

  test("7-9 the urgent view holds the attachment fact only while the flag is on; a mail without a headers row gets no line and no error", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const on = await org(trx);
      const off = await org(trx);
      const other = await org(trx);
      await setOrgFeature(trx, on.ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: T });
      await setOrgFeature(trx, other.ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: T });
      const pdf = { name: "faktura.pdf", type: "application/pdf", size: 122880, inline: false };
      const urgent = (o: Org) =>
        insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      const onId = await urgent(on);
      const offId = await urgent(off);
      const noRowId = await urgent(other);
      await insertAttachmentHeaders(trx, on.ctx, onId, [pdf]);
      await insertAttachmentHeaders(trx, off.ctx, offId, [pdf]);
      // Test 9: flag on, no `email_headers` row.
      expect(noRowId).toBeString();

      await run(trx);

      const onRows = await rows(trx, on.orgId, "urgent");
      expect(onRows).toHaveLength(2);
      for (const row of onRows) {
        expect(row.email_id).toBe(onId);
        expect((row.view as { attachments?: unknown }).attachments).toEqual({
          attachments: [{ ...pdf }],
          count: 1,
        });
        const lines = row.text.split("\n");
        expect(lines[lines.indexOf(lines.find((l) => l.startsWith("Subject:")) as string) + 1]).toBe(
          "📎 1: faktura.pdf (120 kB)"
        );
      }
      // Test 8: flag off: no field, the text of today.
      for (const row of await rows(trx, off.orgId, "urgent")) {
        expect(row.email_id).toBe(offId);
        expect("attachments" in (row.view as object)).toBe(false);
        expect(row.text).not.toContain("📎");
      }
      for (const row of await rows(trx, other.orgId, "urgent")) {
        expect(row.email_id).toBe(noRowId);
        expect("attachments" in (row.view as object)).toBe(false);
        expect(row.text).not.toContain("📎");
      }
      // No attachment name in a log line.
      expect(errorLines.join("\n")).not.toContain("faktura");
    });
  });

  test("F110 stage 16: the urgent view holds the why keys only while why_lines is on", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const on = await org(trx);
      const off = await org(trx);
      await setOrgFeature(trx, on.ctx, { flag: "why_lines", enabled: true, actor: "cli", now: T });
      const urgent = (o: Org, fields: Record<string, unknown>, extra: { reasonCode?: string } = {}) =>
        insertTriaged(trx, o.ctx, o.mailboxId, {
          category: "urgent",
          createdAt: at(-10 * MINUTE_MS),
          confidence: 0.87,
          fields,
          ...extra,
        });
      const ruleId = await urgent(on, { rule: "vip" });
      const modelId = await urgent(on, { rule: null });
      // A result that no model made (an old blocklist row without the rule key): no percent.
      const noModelId = await urgent(on, {}, { reasonCode: "blocklist" });
      const offId = await urgent(off, { rule: "vip" });

      await run(trx);

      const viewOf = async (o: Org, emailId: string) => {
        const row = (await rows(trx, o.orgId, "urgent")).find((entry) => entry.email_id === emailId);
        if (row === undefined) throw new Error("no urgent row");
        return { view: row.view as Record<string, unknown>, text: row.text };
      };
      const withRule = await viewOf(on, ruleId);
      expect(withRule.view).toMatchObject({ confidence: 0.87, rule: "vip" });
      expect(withRule.text).toContain("rule: VIP sender");
      expect(withRule.text).not.toContain("85%");
      const withPercent = await viewOf(on, modelId);
      expect(withPercent.view).toMatchObject({ confidence: 0.87, rule: null });
      expect(withPercent.text).toContain("85%");
      const noModel = await viewOf(on, noModelId);
      expect(noModel.view).toMatchObject({ confidence: null, rule: null });
      expect(noModel.text).not.toContain("%");

      // Flag off: no keys in the view, and no mark in the text.
      const flagOff = await viewOf(off, offId);
      expect("confidence" in flagOff.view).toBe(false);
      expect("rule" in flagOff.view).toBe(false);
      expect(flagOff.text).not.toContain("VIP sender");
      expect(flagOff.text).not.toContain("%");
    });
  });

  test("B1: an urgent mail with an empty reason prints the empty AI line with the flag off, and the mark line with it on", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const on = await org(trx);
      const off = await org(trx);
      await setOrgFeature(trx, on.ctx, { flag: "why_lines", enabled: true, actor: "cli", now: T });
      const make = (o: Org) =>
        insertTriaged(trx, o.ctx, o.mailboxId, {
          category: "urgent",
          createdAt: at(-10 * MINUTE_MS),
          reason: "",
          confidence: 0.87,
        });
      const onId = await make(on);
      const offId = await make(off);

      await run(trx);

      const lines = async (o: Org, emailId: string) => {
        const row = (await rows(trx, o.orgId, "urgent")).find((entry) => entry.email_id === emailId);
        if (row === undefined) throw new Error("no urgent row");
        return row.text.split("\n");
      };
      const offLines = await lines(off, offId);
      expect(offLines.slice(2, 5)).toEqual([
        expect.stringMatching(/^Subject:/),
        "💬 ",
        expect.stringMatching(/^Received/),
      ]);
      const onLines = await lines(on, onId);
      expect(onLines.slice(2, 5)).toEqual([
        expect.stringMatching(/^Subject:/),
        "💬 85%",
        expect.stringMatching(/^Received/),
      ]);
    });
  });

  test("an urgent mail with inline parts only gets no attachment field", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await setOrgFeature(trx, o.ctx, { flag: "attachment_line", enabled: true, actor: "cli", now: T });
      const emailId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });
      await insertAttachmentHeaders(trx, o.ctx, emailId, [
        { name: "logo.png", type: "image/png", size: 5, inline: true },
      ]);
      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found.length).toBeGreaterThan(0);
      for (const row of found) expect("attachments" in (row.view as object)).toBe(false);
    });
  });

  test("a member linked after the mail does not get it", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("chat_links")
        .set({ linked_at: at(-5 * MINUTE_MS) })
        .where("user_id", "=", o.assistantId)
        .execute();
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });

      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found.map((r) => r.user_id)).toEqual([o.ownerId]);
    });
  });

  test("old urgent mail and other categories give no row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx
        .updateTable("chat_links")
        .set({ linked_at: at(-48 * HOUR_MS) })
        .where("org_id", "=", o.orgId)
        .execute();
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-25 * HOUR_MS) });
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "info", createdAt: at(-10 * MINUTE_MS) });

      await run(trx);
      expect(await rows(trx, o.orgId)).toHaveLength(0);
    });
  });

  test("the notice names a source folder; spam folder mail gets none (D23)", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await ensureSyncFolders(trx, o.ctx, o.mailboxId, [{ key: "junk", path: "Wiadomości-śmieci", role: "junk" }], T);
      const offers = await insertTriagedWithActions(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
        folder: "Oferty",
        sourceFolder: "Oferty",
        uid: 21,
        actions: [],
      });
      const junk = await insertTriagedWithActions(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-9 * MINUTE_MS),
        folder: "Wiadomości-śmieci",
        sourceFolder: "Wiadomości-śmieci",
        uid: 22,
        actions: [],
      });

      await run(trx);
      const found = await rows(trx, o.orgId, "urgent");
      expect(found.map((r) => r.email_id)).toEqual([offers.emailId, offers.emailId]);
      for (const row of found) {
        expect(row.text?.split("\n")[0]).toContain("🔴 Urgent mail · 📁 Oferty");
        expect(row.text).toContain("→ stays in Oferty");
      }
      expect(found.some((r) => r.email_id === junk.emailId)).toBe(false);
      const audited = await trx.selectFrom("audit_log").select("id").where("email_id", "=", junk.emailId).execute();
      expect(audited).toHaveLength(0);
    });
  });

  test("a paused mailbox gives no urgent row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await insertTriaged(trx, o.ctx, o.mailboxId, { category: "urgent", createdAt: at(-10 * MINUTE_MS) });
      await setStatus(trx, o, "paused");

      await run(trx);
      expect(await rows(trx, o.orgId, "urgent")).toHaveLength(0);
    });
  });
});
