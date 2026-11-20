import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { sql } from "kysely";

import { insertSenderRule } from "../../src/modules/config";
import { insertMailbox } from "../../src/modules/mail/repo";

import {
  at,
  BODY,
  buttonData,
  org,
  rows,
  run,
  SENDER,
  sendOrg,
  sendState,
  setStatus,
  T,
  waiting,
} from "./channels-notices-helpers";
import { insertDelegate, insertDelegation, insertTriaged, isolateChannels, testCapabilities } from "./fixtures";
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

describe("approval requests", () => {
  test("(1)(2) one request per owner, the assistant gets none; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const p = await waiting(trx, o);

      await run(trx);

      const found = await rows(trx, o.orgId, "approval");
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`approval:${p.sendId}`);
        expect(row.email_id).toBe(p.emailId);
        expect(row.text).toContain(`📤 Send? Delegation to Anna Nowak ${p.to}`);
        expect(row.text).toContain(`From: ${SENDER} · ⚠️ external sender`);
        expect(row.text).toContain("Subject: Fwd: Quarterly offer");
        expect(row.text).toContain("Draft:");
        expect(row.text).toContain("Prepare the offer");
        expect(row.text).toContain("Quoted original:");
        expect(row.text).toContain(BODY);
        expect(row.text).toContain("Do not send the draft from your mail client.");
        expect(buttonData(row)).toEqual([`ap:${p.sendId}`, `ar:${p.sendId}`]);
      }
      expect((await sendState(trx, p.sendId)).notified_at).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(2);
    });
  });

  test("(3) the external warning: whitelisted, own mailbox and same domain", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await insertSenderRule(trx, o.ctx, { mailboxId: null, pattern: "friend@client.test", kind: "whitelist" });
      const secondBoxId = randomUUID();
      const secondAddress = `box2-${secondBoxId}@x.test`;
      await insertMailbox(trx, o.ctx, {
        id: secondBoxId,
        address: secondAddress,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: { drafts: "Drafts" },
      });
      const friend = await waiting(trx, o, { from: "friend@client.test" });
      const internal = await waiting(trx, o, { from: secondAddress });
      const domain = await waiting(trx, o, { from: "someone@x.test" });

      await run(trx);

      const text = async (sendId: string) =>
        (await rows(trx, o.orgId, "approval")).find((r) => r.dedup_key === `approval:${sendId}`)?.text ?? "";
      expect(await text(friend.sendId)).not.toContain("external sender");
      expect(await text(internal.sendId)).not.toContain("external sender");
      expect(await text(domain.sendId)).toContain("⚠️ external sender");
    });
  });

  test("(4)(5) a draft that is not applied and a paused mailbox give no request and no mark", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const ready = await waiting(trx, o, { draftStatus: "ready", draftProviderResult: undefined });

      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);
      expect((await sendState(trx, ready.sendId)).notified_at).toBeNull();

      await trx
        .updateTable("actions")
        .set({ status: "applied", applied_at: T })
        .where("id", "=", ready.draftId)
        .execute();
      await setStatus(trx, o, "paused");
      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);
      expect((await sendState(trx, ready.sendId)).notified_at).toBeNull();
    });
  });

  test("(6)(6b) a clarification names the sender; an inactive delegate is marked", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const question = await waiting(trx, o, { kind: "clarification", to: SENDER, task: "Which date?" });
      const inactiveTo = "olek@x.test";
      const inactiveId = await insertDelegate(trx, o.ctx, { name: "Olek", email: inactiveTo, active: false });
      const inactive = await waiting(trx, o, { to: inactiveTo, delegateId: inactiveId, delegateName: "Olek" });

      await run(trx);

      const found = await rows(trx, o.orgId, "approval");
      const textOf = (sendId: string) => found.find((r) => r.dedup_key === `approval:${sendId}`)?.text ?? "";
      expect(textOf(question.sendId)).toContain(`Question to the sender ${SENDER}`);
      expect(textOf(inactive.sendId)).toContain(`Delegation to Olek (inactive) ${inactiveTo}`);
    });
  });

  test("(7)(13) a reminder set: one request per owner with a task line per item", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const setId = randomUUID();
      const items: { to: string; sendId: string }[] = [];
      for (const [i, name] of ["Anna Nowak", "Piotr Kot"].entries()) {
        const to = `r${i}-${randomUUID()}@x.test`;
        const delegateId = await insertDelegate(trx, o.ctx, { name, email: to });
        const original = await waiting(trx, o, {
          to,
          delegateId,
          delegateName: name,
          sendStatus: "applied",
          approved: { userId: o.ownerId, at: at(-3 * HOUR_MS) },
        });
        const delegationId = await insertDelegation(trx, o.ctx, {
          mailboxId: o.mailboxId,
          emailId: original.emailId,
          delegateId,
          draftActionId: original.draftId,
          sendActionId: original.sendId,
          status: "sent",
          dueAt: new Date("2026-11-10T12:00:00Z"),
        });
        const reminder = await waiting(trx, o, {
          to,
          delegateId,
          delegateName: name,
          reminder: i === 0 ? 1 : 2,
          delegationId,
          setId,
          task: `Task of ${name}`,
        });
        items.push({ to, sendId: reminder.sendId });
      }

      await run(trx);

      const found = await rows(trx, o.orgId, "approval_set");
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      for (const row of found) {
        expect(row.dedup_key).toBe(`approval_set:${setId}`);
        expect(row.text).toContain("📤 Send 2 reminders?");
        expect(row.text).toContain(`Anna Nowak ${items[0]?.to} — Quarterly offer`);
        expect(row.text).toContain("reminder 1 of 2");
        expect(row.text).toContain("reminder 2 of 2");
        expect(row.text).toContain("Task: Task of Anna Nowak");
        expect(row.text).toContain("Task: Task of Piotr Kot");
        expect(buttonData(row)).toEqual([`as:${setId}`, `rs:${setId}`]);
      }
      for (const item of items) expect((await sendState(trx, item.sendId)).notified_at).toEqual(T);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);

      await run(trx);
      expect(await rows(trx, o.orgId, "approval_set")).toHaveLength(2);
    });
  });

  test("(7b) a set with one draft not applied waits whole", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const setId = randomUUID();
      const a = await waiting(trx, o, { reminder: 1, setId });
      const b = await waiting(trx, o, { reminder: 2, setId, draftStatus: "ready", draftProviderResult: undefined });

      await run(trx);

      expect(await rows(trx, o.orgId, "approval_set")).toHaveLength(0);
      expect((await sendState(trx, a.sendId)).notified_at).toBeNull();
      expect((await sendState(trx, b.sendId)).notified_at).toBeNull();
    });
  });

  test("(8) synthetic mail is marked as a test", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await waiting(trx, o, { messageId: `<seed-${randomUUID()}@ea-seed.test>` });
      await run(trx);
      const found = await rows(trx, o.orgId, "approval");
      expect(found).toHaveLength(2);
      for (const row of found) expect(row.text).toContain("🧪 test");
    });
  });

  test("(9) the outbox row holds the mail id", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const p = await waiting(trx, o);
      await run(trx);
      for (const row of await rows(trx, o.orgId, "approval")) expect(row.email_id).toBe(p.emailId);
    });
  });

  test("(10) only an assistant linked: no request, no mark", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await org(trx);
      await trx.deleteFrom("chat_links").where("user_id", "=", o.ownerId).execute();
      const p = await waiting(trx, o);
      await run(trx);
      expect(await rows(trx, o.orgId, "approval")).toHaveLength(0);
      expect((await sendState(trx, p.sendId)).notified_at).toBeNull();
    });
  });

  test("(11) tenant: another organization's send is not listed", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await org(trx);
      const b = await org(trx);
      const p = await waiting(trx, b);
      await run(trx);
      expect(await rows(trx, a.orgId, "approval")).toHaveLength(0);
      const found = await rows(trx, b.orgId, "approval");
      expect(found).toHaveLength(1);
      expect(found[0]?.dedup_key).toBe(`approval:${p.sendId}`);
      expect((await sendState(trx, p.sendId)).notified_at).toEqual(T);
    });
  });

  test("(12) a broken row is skipped with one warn line; the others still go out", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const broken = await waiting(trx, o, { createdAt: at(-40 * MINUTE_MS) });
      const good = await waiting(trx, o);
      await sql`update actions set payload = jsonb_set(payload, '{kind}', '"nope"') where id = ${broken.draftId}`.execute(
        trx
      );
      const urgentId = await insertTriaged(trx, o.ctx, o.mailboxId, {
        category: "urgent",
        createdAt: at(-10 * MINUTE_MS),
      });

      await run(trx);
      await run(trx);

      expect((await rows(trx, o.orgId, "approval")).map((r) => r.dedup_key)).toEqual([
        `approval:${good.sendId}`,
        `approval:${good.sendId}`,
      ]);
      expect((await rows(trx, o.orgId, "urgent")).filter((r) => r.email_id === urgentId)).toHaveLength(3);
      expect((await sendState(trx, broken.sendId)).notified_at).toBeNull();
      const warns = errorLines.filter((line) =>
        line.includes(`notice_skipped kind=approval item_id=${broken.sendId} `)
      );
      expect(warns).toHaveLength(1);
      expect(warns[0]).toMatch(/^\[channels\] notice_skipped kind=approval item_id=[0-9a-f-]{36} error=\w+/);
      expect(errorLines.filter((line) => line.includes("dropped_fields"))).toEqual([]);
    });
  });
});
