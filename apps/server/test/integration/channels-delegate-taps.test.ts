import { encodeCallback, MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { detectNotices, handleCallback } from "../../src/modules/channels";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import { EIGHT, ready, type BriefOrg } from "./channels-digest-brief-fixtures";
import { dataOf, deliverDigest, linkOf, MESSAGE_AT, tapDeps } from "./channels-loop-taps-fixtures";
import { insertDelegate, insertTriaged, renderedOf } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The Delegate button and the picker. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const MAIL_AT = new Date("2026-11-19T09:00:00Z");

// An organization with the flag `delegate_button`, one active delegate and a `needs_reply` mail of the digest window.
async function delegateOrg(
  trx: Transaction<DB>,
  opts: { delegates?: number; category?: "needs_reply" | "info" | "urgent" } = {}
): Promise<BriefOrg & { emailId: string; delegateIds: string[] }> {
  const org = await ready(trx);
  await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: true, actor: "cli", now: MESSAGE_AT });
  const delegateIds: string[] = [];
  for (let i = 0; i < (opts.delegates ?? 1); i += 1) {
    delegateIds.push(await insertDelegate(trx, org.ctx, { name: `Delegate ${i + 1}` }));
  }
  const emailId = await insertTriaged(trx, org.ctx, org.mailboxId, {
    category: opts.category ?? "needs_reply",
    createdAt: MAIL_AT,
    subject: "Offer for the autumn campaign",
    fields: { language: "en" },
  });
  return { ...org, emailId, delegateIds };
}

const open = (emailId: string) => encodeCallback({ kind: "delegate_open", emailId });
const pick = (emailId: string, delegateId: string) => encodeCallback({ kind: "delegate_pick", emailId, delegateId });
const tap = (trx: Transaction<DB>, org: BriefOrg, data: string, webBaseUrl?: string) =>
  handleCallback(tapDeps(trx, MESSAGE_AT, webBaseUrl), linkOf(org), data);

describe("T9 the Delegate button of the digest rows", () => {
  test("a needs_reply row has [👥 n], two rows share one keyboard line of at most 8 buttons", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx);
      const unsure = await insertTriaged(trx, org.ctx, org.mailboxId, {
        category: "unsure",
        createdAt: new Date(MAIL_AT.getTime() - MINUTE_MS),
      });
      const info = await insertTriaged(trx, org.ctx, org.mailboxId, { category: "info", createdAt: MAIL_AT });
      const { message } = await deliverDigest(trx);
      // The 👥 of a row sits in its row of the keyboard, after its ✅ and ✏️; the info row has none.
      expect(message.buttons.flat().filter((button) => button.text.startsWith("👥"))).toEqual([
        { text: "👥 1", data: open(org.emailId) },
        { text: "👥 2", data: open(unsure) },
      ]);
      expect(dataOf(message)).not.toContain(open(info));
      expect(Math.max(...message.buttons.map((row) => row.length))).toBeLessThanOrEqual(8);
    });
  });

  test("an info row has none; no active delegate, no flag, shadow mode, drafts off or a suspicious mail: none", async () => {
    const buttons = async (prepare: (trx: Transaction<DB>, org: BriefOrg & { emailId: string }) => Promise<void>) => {
      let found: string[] = [];
      await withRollback(db, async (trx) => {
        const org = await delegateOrg(trx);
        await prepare(trx, org);
        const { message } = await deliverDigest(trx);
        found = message.buttons.flat().map((button) => button.text);
      });
      return found;
    };
    expect(await buttons(async () => undefined)).toContain("👥 1");
    expect(
      await buttons(async (trx, org) => {
        await trx.updateTable("triage_results").set({ category: "info" }).where("email_id", "=", org.emailId).execute();
      })
    ).not.toContain("👥 1");
    expect(
      await buttons(async (trx, org) => {
        await trx.updateTable("delegates").set({ active: false }).where("org_id", "=", org.ctx.orgId).execute();
      })
    ).not.toContain("👥 1");
    expect(
      await buttons(async (trx, org) => {
        await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: false, actor: "cli", now: MESSAGE_AT });
      })
    ).not.toContain("👥 1");
    expect(
      await buttons(async (trx, org) => {
        await trx
          .updateTable("mailbox_settings")
          .set({ mode: "shadow" })
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
      })
    ).not.toContain("👥 1");
    expect(
      await buttons(async (trx, org) => {
        await trx
          .updateTable("mailbox_settings")
          .set({ tool_switches: JSON.stringify({ create_draft: false }) })
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
      })
    ).not.toContain("👥 1");
    expect(
      await buttons(async (trx, org) => {
        await trx
          .updateTable("triage_results")
          .set({ suspicious_reasons: ["lookalike_domain"] })
          .where("email_id", "=", org.emailId)
          .execute();
      })
    ).not.toContain("👥 1");
  });
});

describe("T10 the picker", () => {
  test("two delegates: a picker with two buttons, the answer is empty", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx, { delegates: 2 });
      const result = await tap(trx, org, open(org.emailId));
      expect(result.answer).toBe("");
      expect(result.send?.text).toBe("Delegate to:");
      expect(result.send?.buttons.flat()).toEqual(
        org.delegateIds.map((id, i) => ({ text: `Delegate ${i + 1}`, data: pick(org.emailId, id) }))
      );
      for (const button of result.send?.buttons.flat() ?? []) expect(button.data.length).toBeLessThanOrEqual(48);
    });
  });

  test("nine delegates: eight buttons and the panel line with the link", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx, { delegates: 9 });
      const result = await tap(trx, org, open(org.emailId), "https://app.example.test/");
      expect(result.send?.buttons.flat()).toHaveLength(8);
      expect(result.send?.text).toBe("Delegate to:\nMore delegates in the panel: https://app.example.test/delegates");
      const noLink = await tap(trx, org, open(org.emailId));
      expect(noLink.send?.text).toBe("Delegate to:\nMore delegates in the panel");
    });
  });

  test("a delegate name with the remains of an escape sequence is cleaned in the picker button (review 19 TG2)", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx, { delegates: 0 });
      await insertDelegate(trx, org.ctx, { name: "\u001b[31mAnna\u001b[0m [31mKowalska" });
      const result = await tap(trx, org, open(org.emailId));
      const names = result.send?.buttons.flat().map((button) => button.text);
      expect(names).toEqual(["Anna Kowalska"]);
    });
  });

  test("a member, no delegate, the flag off, an unknown mail and a mail of another organization answer with a fixed text", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx);
      const member = linkOf(org, { role: "assistant", userId: org.memberId });
      expect(await handleCallback(tapDeps(trx), member, open(org.emailId))).toEqual({
        answer: "Only an owner can do this.",
      });
      expect(await handleCallback(tapDeps(trx), member, pick(org.emailId, org.delegateIds[0] as string))).toEqual({
        answer: "Only an owner can do this.",
      });
      const other = await delegateOrg(trx);
      const foreign = (await tap(trx, org, open(other.emailId))).answer;
      expect(foreign).toBe("This item is not in your account.");
      expect((await tap(trx, org, open("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"))).answer).toBe(foreign);
      await trx.updateTable("delegates").set({ active: false }).where("org_id", "=", org.ctx.orgId).execute();
      expect((await tap(trx, org, open(org.emailId))).answer).toBe("No active delegate.");
      await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: false, actor: "cli", now: MESSAGE_AT });
      expect((await tap(trx, org, open(org.emailId))).answer).toBe("The Delegate button is off.");
    });
  });
});

describe("T11 the pick", () => {
  test("a pick makes a drafted delegation with source button; the picker becomes the result line; a second pick says 'already'", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx, { delegates: 2 });
      const [first, second] = org.delegateIds as [string, string];
      const result = await tap(trx, org, pick(org.emailId, first));
      expect(result.answer).toBe("Delegation drafted. Check the card.");
      expect(result.edit).toEqual({ text: "Delegation drafted. Check the card.", buttons: [] });
      const rows = await trx.selectFrom("delegations").selectAll().where("email_id", "=", org.emailId).execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "drafted", source: "button", delegate_id: first });
      // The same pick, and a pick of another delegate: the mail has its delegation already.
      for (const delegate of [first, second]) {
        const again = await tap(trx, org, pick(org.emailId, delegate));
        expect(again.answer).toBe("This mail already has a delegation.");
        expect(again.edit?.buttons).toEqual([]);
      }
      expect(
        await trx.selectFrom("delegations").select("id").where("email_id", "=", org.emailId).execute()
      ).toHaveLength(1);
    });
  });

  test("an inactive delegate, drafts off and a mail that cannot be delegated: one text each; the Polish text", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx);
      const delegate = org.delegateIds[0] as string;
      await trx.updateTable("delegates").set({ active: false }).where("id", "=", delegate).execute();
      expect((await tap(trx, org, pick(org.emailId, delegate))).answer).toBe("This delegate is not active any more.");
      await trx.updateTable("delegates").set({ active: true }).where("id", "=", delegate).execute();
      await trx.updateTable("triage_results").set({ category: "spam" }).where("email_id", "=", org.emailId).execute();
      expect((await tap(trx, org, pick(org.emailId, delegate))).answer).toBe("This mail cannot be delegated.");
      await trx
        .updateTable("triage_results")
        .set({ category: "needs_reply" })
        .where("email_id", "=", org.emailId)
        .execute();
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ create_draft: false }) })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      expect((await tap(trx, org, pick(org.emailId, delegate))).answer).toBe("Drafts are off for this mailbox.");
      await trx
        .updateTable("mailbox_settings")
        .set({ tool_switches: JSON.stringify({ create_draft: true }) })
        .where("mailbox_id", "=", org.mailboxId)
        .execute();
      const pl = await handleCallback(tapDeps(trx), linkOf(org, { locale: "pl" }), pick(org.emailId, delegate));
      expect(pl.answer).toBe("Zlecenie gotowe. Sprawdź kartę.");
    });
  });
});

describe("T12 the urgent notice", () => {
  const urgentRow = async (trx: Transaction<DB>, org: BriefOrg & { emailId: string }) => {
    const now = new Date(EIGHT);
    await trx
      .updateTable("triage_results")
      .set({ created_at: new Date(now.getTime() - 600_000) })
      .where("email_id", "=", org.emailId)
      .execute();
    await detectNotices({
      db: trx,
      now: () => now,
      startedAt: new Date(now.getTime() - HOUR_MS),
      testMail: NO_TEST_SENDERS,
    });
    const [row] = await trx
      .selectFrom("outbox")
      .select(["kind", "view", "channel", "detail", "locale", "text", "buttons"])
      .where("org_id", "=", org.ctx.orgId)
      .where("kind", "=", "urgent")
      .execute();
    return row as NonNullable<typeof row>;
  };

  test("an urgent notice has the Delegate button", async () => {
    await withRollback(db, async (trx) => {
      const org = await delegateOrg(trx, { category: "urgent" });
      const row = await urgentRow(trx, org);
      const message = renderedOf(row);
      expect(message.buttons[0]?.map((button) => button.text)).toEqual(["✅ Right", "✏️ Change", "👥 Delegate"]);
      expect(message.buttons[0]?.at(-1)?.data).toBe(open(org.emailId));
      expect((row.view as { delegable?: boolean }).delegable).toBe(true);
    });
  });

  test("without an active delegate, with a suspicious mail, with drafts off or the flag off: the keyboard of today", async () => {
    const variants: ((trx: Transaction<DB>, org: BriefOrg & { emailId: string }) => Promise<void>)[] = [
      async (trx, org) => {
        await trx.updateTable("delegates").set({ active: false }).where("org_id", "=", org.ctx.orgId).execute();
      },
      async (trx, org) => {
        await trx
          .updateTable("triage_results")
          .set({ suspicious_reasons: ["lookalike_domain"] })
          .where("email_id", "=", org.emailId)
          .execute();
      },
      async (trx, org) => {
        await trx
          .updateTable("mailbox_settings")
          .set({ mode: "shadow" })
          .where("mailbox_id", "=", org.mailboxId)
          .execute();
      },
      async (trx, org) => {
        await setOrgFeature(trx, org.ctx, { flag: "delegate_button", enabled: false, actor: "cli", now: MESSAGE_AT });
      },
    ];
    for (const prepare of variants) {
      await withRollback(db, async (trx) => {
        const org = await delegateOrg(trx, { category: "urgent" });
        await prepare(trx, org);
        const row = await urgentRow(trx, org);
        // No field at all: a view without it also renders in the code from before the field existed.
        expect("delegable" in (row.view as object)).toBe(false);
        expect(renderedOf(row).buttons[0]).toHaveLength(2);
      });
    }
  });
});
