import { randomUUID } from "node:crypto";

import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type Transaction } from "kysely";

import { SENT_COPY_PENDING_MAX_AGE_MS } from "../../src/modules/actions";
import { auditEvents, recordAudit } from "../../src/modules/audit";
import { setOrgFeature } from "../../src/modules/tenancy";
import type { DB } from "../../src/platform/db";

import {
  at,
  BODY,
  buttonData,
  ended,
  Org,
  org,
  rows,
  run,
  SENDER,
  sendOrg,
  sendState,
  T,
  waiting,
} from "./channels-notices-helpers";
import { insertAction, isolateChannels } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorSpy: ReturnType<typeof spyOn>;
let logSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation((): void => undefined);
  errorSpy = spyOn(console, "error").mockImplementation((): void => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

async function resultText(trx: Transaction<DB>, o: Org, sendId: string): Promise<{ text: string; data: string[] }> {
  const found = (await rows(trx, o.orgId, "send_result")).filter((r) => r.dedup_key === `send_result:${sendId}`);
  expect(found.length).toBeGreaterThan(0);
  return { text: found[0]?.text ?? "", data: found[0] === undefined ? [] : buttonData(found[0]) };
}

describe("send result notices", () => {
  test("(1)(6) sent: one row per owner; the copy outcome; a second run adds none", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const ok = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE_MS),
        providerResult: { sent_copy: "appended" },
      });
      const noCopy = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE_MS),
        providerResult: { sent_copy: "failed" },
      });

      await run(trx);

      const found = (await rows(trx, o.orgId, "send_result")).filter((r) => r.dedup_key === `send_result:${ok.sendId}`);
      expect(found.map((r) => r.user_id).sort()).toEqual([o.ownerId, o.secondOwnerId].sort());
      for (const row of found) {
        expect(row.email_id).toBe(ok.emailId);
        expect(row.text).toContain(`✅ Sent to Anna Nowak ${ok.to} · Fwd: Quarterly offer`);
        expect(row.text).not.toContain("No copy in Sent");
      }
      expect((await resultText(trx, o, noCopy.sendId)).text).toContain("No copy in Sent");
      expect((await sendState(trx, ok.sendId)).result_notified_at).toEqual(T);

      await run(trx);
      expect(await rows(trx, o.orgId, "send_result")).toHaveLength(4);
    });
  });

  test("(1b) a pending copy waits 10 minutes, then counts as failed", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const young = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-MINUTE_MS),
        providerResult: { sent_copy: "pending" },
      });
      const old = await ended(trx, o, {
        status: "applied",
        appliedAt: new Date(T.getTime() - SENT_COPY_PENDING_MAX_AGE_MS - MINUTE_MS),
        providerResult: { sent_copy: "pending" },
      });

      await run(trx);

      const keys = (await rows(trx, o.orgId, "send_result")).map((r) => r.dedup_key);
      expect(keys).not.toContain(`send_result:${young.sendId}`);
      expect((await sendState(trx, young.sendId)).result_notified_at).toBeNull();
      expect((await resultText(trx, o, old.sendId)).text).toContain("No copy in Sent");
    });
  });

  test('(1d) a copy that the provider saves (a Graph send) reads as found: no "No copy" line', async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const graph = await ended(trx, o, {
        status: "applied",
        appliedAt: at(-20 * MINUTE_MS),
        providerResult: { sent_copy: "provider" },
      });

      await run(trx);

      const text = (await resultText(trx, o, graph.sendId)).text;
      expect(text).toContain(`✅ Sent to Anna Nowak ${graph.to} · Fwd: Quarterly offer`);
      expect(text).not.toContain("No copy in Sent");
    });
  });

  test("(1c) the draft line follows the reverse row", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const applied = { status: "applied", appliedAt: at(-20 * MINUTE_MS), providerResult: { sent_copy: "appended" } };
      const removed = await ended(trx, o, applied);
      await insertAction(trx, o.ctx, removed.emailId, {
        type: "create_draft",
        status: "ready",
        reversesActionId: removed.draftId,
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "sent" },
      });
      const stays = await ended(trx, o, applied);

      await run(trx);

      expect((await resultText(trx, o, removed.sendId)).text).not.toContain("no UIDPLUS");
      expect((await resultText(trx, o, stays.sendId)).text).toContain("The draft stays in Drafts (no UIDPLUS");
    });
  });

  test("(1c) the mistake button: flag on adds it to a sent result and to the view; flag off and a failed result do not", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const sent = { status: "applied", appliedAt: at(-20 * MINUTE_MS), providerResult: { sent_copy: "appended" } };
      const before = await ended(trx, o, sent);
      await run(trx);
      expect((await resultText(trx, o, before.sendId)).data).toEqual([]);
      const viewOf = async (sendId: string) =>
        (
          await trx
            .selectFrom("outbox")
            .select("view")
            .where("org_id", "=", o.orgId)
            .where("dedup_key", "=", `send_result:${sendId}`)
            .executeTakeFirstOrThrow()
        ).view as Record<string, unknown>;
      expect("mistakeButton" in (await viewOf(before.sendId))).toBe(false);

      await setOrgFeature(trx, { orgId: o.orgId }, { flag: "mistake_capture", enabled: true, actor: "cli", now: T });
      const after = await ended(trx, o, sent);
      const failed = await ended(trx, o, {
        status: "failed",
        reason: "smtp_rejected",
        providerResult: { stage: "envelope" },
      });
      await run(trx);

      expect((await resultText(trx, o, after.sendId)).data).toEqual([`mk:${after.sendId}`]);
      expect((await viewOf(after.sendId)).mistakeButton).toBe(true);
      expect((await resultText(trx, o, failed.sendId)).data).toEqual([]);
      expect("mistakeButton" in (await viewOf(failed.sendId))).toBe(false);
    });
  });

  test("(2) refused by the server: the cancel line only for a delegation", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const patch = {
        status: "failed",
        reason: "smtp_rejected",
        providerResult: { stage: "envelope", response_code: 550 },
      };
      const delegation = await ended(trx, o, patch);
      const question = await ended(trx, o, patch, { kind: "clarification", to: SENDER });

      await run(trx);

      const d = await resultText(trx, o, delegation.sendId);
      expect(d.text).toContain(`❌ Not sent to Anna Nowak ${delegation.to} · Fwd: Quarterly offer`);
      expect(d.text).toContain("refused it (envelope, code 550)");
      expect(d.text).toContain("The delegation was cancelled.");
      expect(d.data).toEqual([]);
      const q = await resultText(trx, o, question.sendId);
      expect(q.text).toContain("refused it (envelope, code 550)");
      expect(q.text).not.toContain("The delegation was cancelled.");
      expect(q.data).toEqual([]);
    });
  });

  test("(3)(3b) outcome unknown: the warning and the send again button; no action_failed notice", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const first = await ended(trx, o, { status: "failed", reason: "outcome_unknown" });
      await trx.updateTable("actions").set({ result_notified_at: T }).where("id", "=", first.sendId).execute();
      const again = await insertAction(trx, o.ctx, first.emailId, {
        type: "send",
        status: "failed",
        statusReason: "outcome_unknown",
        payload: { kind: "delegation", to: [first.to] },
        dependsOnActionId: first.draftId,
        idempotencyKey: `${first.sendId}:again`,
        createdAt: at(-20 * MINUTE_MS),
      });

      await run(trx);

      const found = await rows(trx, o.orgId, "send_result");
      expect(found.filter((r) => r.dedup_key === `send_result:${again}`)).toHaveLength(2);
      const result = await resultText(trx, o, again);
      expect(result.text).toContain("⚠️ Unknown whether the mail to");
      expect(result.data).toEqual([`ag:${again}`, `gw:${again}`]);
      expect(await rows(trx, o.orgId, "action_failed")).toHaveLength(0);
    });
  });

  test("(3c) smtp errors by stage, and a bad payload", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const content = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 1,
        providerResult: { stage: "content", response_code: 451 },
      });
      const compose = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 3,
        providerResult: { stage: "compose" },
      });
      const tries = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 5,
        providerResult: { stage: "connect", code: "ETIMEDOUT" },
      });
      const capped = await ended(trx, o, {
        status: "failed",
        reason: "smtp_error",
        attempts: 0,
        providerResult: { stage: "envelope", response_code: 450, code: "EENVELOPE", cap: "soft_retry" },
      });
      const bad = await ended(trx, o, { status: "failed", reason: "bad_payload", attempts: 1 });
      // A reply whose text still held a gap at the claim: nothing was sent; it has its own cause text.
      const gaps = await ended(trx, o, { status: "failed", reason: "has_gaps", attempts: 0 });

      await run(trx);

      const c = await resultText(trx, o, content.sendId);
      expect(c.text).toContain("refused the content for now (code 451)");
      expect(c.data).toEqual([`ag:${content.sendId}`]);
      const m = await resultText(trx, o, compose.sendId);
      expect(m.text).toContain("The mail could not be built 3 times");
      expect(m.data).toEqual([`ag:${compose.sendId}`]);
      const t = await resultText(trx, o, tries.sendId);
      expect(t.text).toContain("The send failed 5 times (ETIMEDOUT)");
      expect(t.data).toEqual([`ag:${tries.sendId}`]);
      const cap = await resultText(trx, o, capped.sendId);
      expect(cap.text).toContain("The mail server did not accept the mail for 6 hours (450); nothing was sent");
      expect(cap.data).toEqual([`ag:${capped.sendId}`]);
      const b = await resultText(trx, o, bad.sendId);
      expect(b.text).toContain("The stored send data is not valid; nothing was sent");
      expect(b.data).toEqual([]);
      const g = await resultText(trx, o, gaps.sendId);
      expect(g.text).toContain("The reply still has a gap marked with [[ ]] that nobody filled; nothing was sent");
      expect(g.text).not.toContain("The stored send data is not valid");
      expect(g.data).toEqual([]);
    });
  });

  test("(4) expired: the reason lines and the draft line", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const timeout = await ended(trx, o, { status: "expired", reason: "timeout" });
      await insertAction(trx, o.ctx, timeout.emailId, {
        type: "create_draft",
        status: "ready",
        reversesActionId: timeout.draftId,
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "expired" },
      });
      const held = await ended(trx, o, { status: "expired", reason: "held_timeout" });
      const closed = await ended(trx, o, { status: "expired", reason: "delegation_closed" });

      await run(trx);

      const t = (await resultText(trx, o, timeout.sendId)).text;
      expect(t).toContain("⌛ Not sent: the approval expired (48 h) · Fwd: Quarterly offer");
      expect(t).toContain("The draft was removed.");
      const h = (await resultText(trx, o, held.sendId)).text;
      expect(h).toContain("it waited 48 h after your approval and was not sent");
      expect(h).toContain("The draft stays in Drafts.");
      expect((await resultText(trx, o, closed.sendId)).text).toContain("the delegation was closed");
    });
  });

  test("(4c) failed copy_check_error: the cause text and the Send again button", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const failed = await ended(trx, o, {
        status: "failed",
        reason: "copy_check_error",
        providerResult: { stage: "copy_check" },
        attempts: 3,
      });

      await run(trx);

      const result = await resultText(trx, o, failed.sendId);
      expect(result.text).toContain("The system could not read the draft in your mailbox; nothing was sent");
      expect(result.data).toEqual([`ag:${failed.sendId}`]);
    });
  });

  test("(1c) the card line allows an edit in the mail client only while the flag draft_copy_check is on", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const off = await sendOrg(trx);
      await waiting(trx, off);
      const on = await sendOrg(trx);
      await waiting(trx, on);
      await setOrgFeature(trx, on.ctx, { flag: "draft_copy_check", enabled: true, actor: "cli", now: T });

      await run(trx);

      for (const row of await rows(trx, off.orgId, "approval")) {
        expect(row.text).toContain("Do not send the draft from your mail client.");
        expect(row.text).not.toContain("Edit here, or edit and send in your mail client.");
      }
      const flagged = await rows(trx, on.orgId, "approval");
      expect(flagged.length).toBeGreaterThan(0);
      for (const row of flagged) {
        expect(row.text).toContain("Edit here, or edit and send in your mail client.");
        expect(row.text).not.toContain("Do not send the draft from your mail client.");
      }
    });
  });

  test("(4b) expired draft_changed: the text names the edit in the mail client, and the draft stays", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const changed = await ended(trx, o, { status: "expired", reason: "draft_changed" });
      // The copy of a changed draft is kept: no reverse row removes it.
      await run(trx);

      const text = (await resultText(trx, o, changed.sendId)).text;
      expect(text).toContain(
        "✏️ You edited this draft in your mail client. Send it from there. · Fwd: Quarterly offer"
      );
      expect(text).toContain("The draft stays in Drafts.");
    });
  });

  test("(4d) a reply that closes for a reply reason (F115 stage 09) gets a result notice with its own text", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      const cases: [string, string, boolean][] = [
        ["answered", "You already answered this mail. The system sent nothing.", true],
        ["sent_by_user", "It looks like you sent it from your mail client. The system sent nothing.", false],
        [
          "newer_mail",
          "A newer mail arrived in this thread. Nothing was sent. Read the newer mail; a new draft may follow.",
          true,
        ],
        ["original_moved", "The mail was moved to another folder. Nothing was sent.", true],
        [
          "suspicious",
          "The mail was marked as suspicious after the draft was made. Nothing was sent. Read the mail with care; a new draft may follow.",
          true,
        ],
        ["draft_missing", "the draft is not in your Drafts folder", false],
      ];
      const sends: [string, string, boolean][] = [];
      for (const [reason, text, draftLine] of cases) {
        const p = await ended(trx, o, { status: "expired", reason }, { kind: "reply", to: `a-${randomUUID()}@x.test` });
        sends.push([p.sendId, text, draftLine]);
      }

      await run(trx);

      for (const [sendId, text, draftLine] of sends) {
        const row = await resultText(trx, o, sendId);
        expect(row.text).toContain(text);
        expect(row.text.includes("The draft stays in Drafts.")).toBe(draftLine);
        expect(row.data).toEqual([]);
        expect((await sendState(trx, sendId)).result_notified_at).toEqual(T);
      }
    });
  });

  test("(5) rejected: the name of the rejecting owner", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const o = await sendOrg(trx);
      await trx.updateTable("users").set({ display_name: "Marta Lis" }).where("id", "=", o.secondOwnerId).execute();
      const p = await ended(trx, o, { status: "rejected" });
      await recordAudit(trx, o.ctx, {
        emailId: p.emailId,
        actionId: p.sendId,
        actor: o.secondOwnerId,
        event: auditEvents.actionRejected,
        data: { via: "telegram" },
      });

      await run(trx);

      expect((await resultText(trx, o, p.sendId)).text).toContain("✖️ Rejected by Marta Lis · Fwd: Quarterly offer");
    });
  });

  test("(8)(9) tenant isolation; no sender address and no body text in a result", async () => {
    await withRollback(db, async (trx) => {
      await isolateChannels(trx);
      const a = await sendOrg(trx);
      const b = await org(trx);
      const p = await ended(trx, b, { status: "expired", reason: "timeout" });
      const mine = await ended(trx, a, {
        status: "failed",
        reason: "smtp_rejected",
        providerResult: { stage: "envelope", response_code: 550 },
      });

      await run(trx);

      expect(await rows(trx, a.orgId, "send_result")).toHaveLength(2);
      expect((await rows(trx, b.orgId, "send_result")).map((r) => r.dedup_key)).toEqual([`send_result:${p.sendId}`]);
      for (const row of [...(await rows(trx, a.orgId, "send_result")), ...(await rows(trx, b.orgId, "send_result"))]) {
        expect(row.text).not.toContain(SENDER);
        expect(row.text).not.toContain(BODY);
        expect(JSON.stringify(row.view)).not.toContain(SENDER);
        expect(JSON.stringify(row.view)).not.toContain(BODY);
      }
      expect((await resultText(trx, a, mine.sendId)).text).toContain(mine.to);
    });
  });
});
