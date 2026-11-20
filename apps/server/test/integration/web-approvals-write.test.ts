import { randomUUID } from "node:crypto";

import {
  approvalApproveAnswerSchema,
  approvalConflictSchema,
  approvalEditAnswerSchema,
  approvalRejectAnswerSchema,
  HOUR_MS,
} from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { updateMailboxSettings } from "../../src/modules/config";
import { setOrgFeature } from "../../src/modules/tenancy";

import { insertDelegation } from "./fixtures";
import { testDb } from "./helpers";
import { approvalKit, bodyOf, NOW, post, ROUTES } from "./web-approvals-kit";
import { TEST_ORIGIN } from "./web-helpers";

// Approvals write API: approve, reject and edit from the panel. Owner only; the rules of the service; the Telegram cards follow.
const db = testDb();
const { cleanup, inTrx, setup, addSend, insertDelegateNow, send, auditOf, editRows, sendCount } = approvalKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

describe("POST /api/approvals/:id/approve, /reject, /edit", () => {
  test("T1. a member gets 403 owner_only on all three routes; the send is unchanged", async () => {
    const s = await setup();
    const id = await addSend(s);
    for (const route of ROUTES) {
      const res = await s.app.request(`/api/approvals/${id}/${route}`, post("member", route, bodyOf(route)));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "owner_only" });
    }
    expect(await send(id)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    expect(await editRows(s.org.orgId)).toEqual([]);
    expect(await sendCount(s.org.orgId)).toBe(1);
  });

  test("T2/T3. the owner approves; the cards of both owners are queued; a second call changes nothing", async () => {
    const s = await setup();
    const id = await addSend(s);
    const res = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(res.status).toBe(200);
    expect(approvalApproveAnswerSchema.parse(await res.json())).toEqual({ status: "approved" });
    expect(await send(id)).toMatchObject({ status: "approved", approved_by: s.org.ownerId, approved_via: "web" });
    const audit = (await auditOf(id)).filter((row) => row.event === "action.approved");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.data).toMatchObject({ via: "web" });
    const rows = await editRows(s.org.orgId);
    expect(rows.map((row) => row.user_id).sort()).toEqual([s.org.ownerId, s.u2].sort());
    expect(rows.every((row) => row.dedup_key.endsWith(":approved"))).toBe(true);

    const again = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(again.status).toBe(200);
    expect(approvalApproveAnswerSchema.parse(await again.json())).toEqual({ status: "approved" });
    expect((await auditOf(id)).filter((row) => row.event === "action.approved")).toHaveLength(1);
    expect(await editRows(s.org.orgId)).toHaveLength(2);
  });

  test("T4. with SEND_SCOPE off the answer is approved_held with heldBy scope; the cards say held", async () => {
    const s = await setup({ sendScope: { kind: "off" } });
    const id = await addSend(s);
    const res = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(res.status).toBe(200);
    expect(approvalApproveAnswerSchema.parse(await res.json())).toEqual({ status: "approved_held", heldBy: "scope" });
    expect((await editRows(s.org.orgId)).every((row) => row.dedup_key.endsWith(":approved_held"))).toBe(true);
  });

  test("T5. a draft that is not in Drafts yet: 409 draft_not_ready, nothing changes", async () => {
    const s = await setup();
    const id = await addSend(s, { draftStatus: "ready" });
    const res = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "draft_not_ready" });
    expect(await send(id)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    expect(await editRows(s.org.orgId)).toEqual([]);
  });

  test("T5b. a reply that still has a gap: 409 has_gaps; with the flag off: 409 feature_off; nothing changes", async () => {
    const s = await setup();
    const id = await addSend(s, { kind: "reply", replyBody: "Tak [[godzina]]" });

    // The flag `reply_drafts` is off by default.
    const off = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(off.status).toBe(409);
    expect(approvalConflictSchema.parse(await off.json())).toEqual({ error: "feature_off" });

    await setOrgFeature(db, s.ctx, { flag: "reply_drafts", enabled: true, actor: "cli", now: NOW });
    const gaps = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(gaps.status).toBe(409);
    expect(approvalConflictSchema.parse(await gaps.json())).toEqual({ error: "has_gaps" });
    expect(await send(id)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    expect(await editRows(s.org.orgId)).toEqual([]);
  });

  test("T6. a send that waited 49 hours: 409 closed, state expired; the send expires and each owner's card gets the expired edit", async () => {
    const s = await setup();
    const id = await addSend(s, { notifiedAt: new Date(NOW.getTime() - 49 * HOUR_MS) });
    const res = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(res.status).toBe(409);
    expect(approvalConflictSchema.parse(await res.json())).toEqual({ error: "closed", state: "expired" });
    expect(await send(id)).toMatchObject({ status: "expired", status_reason: "timeout" });
    // The panel has no card of its own, so both owners' cards lose their buttons.
    const rows = await editRows(s.org.orgId);
    expect(rows.map((row) => row.user_id).sort()).toEqual([s.org.ownerId, s.u2].sort());
    expect(rows.every((row) => row.status === "pending" && row.dedup_key.endsWith(":expired"))).toBe(true);
    // A second approve answers 409 and queues no second edit (the send is not closed by this request any more).
    await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    expect(await editRows(s.org.orgId)).toHaveLength(2);
  });

  test("T6b. a closed send answers 409 closed with its state, for approve and reject", async () => {
    const s = await setup();
    const rejected = await addSend(s, { sendStatus: "rejected" });
    const sent = await addSend(s, { sendStatus: "applied", approved: { userId: s.org.ownerId, at: NOW } });
    const sending = await addSend(s, { sendStatus: "applying", approved: { userId: s.org.ownerId, at: NOW } });
    const failed = await addSend(s, { sendStatus: "failed" });
    for (const [id, state] of [
      [rejected, "rejected"],
      [sent, "sent"],
      [sending, "sending"],
      [failed, "failed"],
    ] as const) {
      const res = await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "closed", state });
    }
    const res = await s.app.request(`/api/approvals/${sent}/reject`, post("owner", "reject"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "closed", state: "sent" });
  });

  test("T7. the owner rejects; the delegation is cancelled; the cards say rejected", async () => {
    const s = await setup();
    const anna = await insertDelegateNow(s, { name: "Anna" });
    const id = await addSend(s, { delegateId: anna });
    const row = await db
      .selectFrom("actions")
      .select(["email_id", "depends_on_action_id"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    const delegationId = await db.transaction().execute((trx) =>
      insertDelegation(trx, s.ctx, {
        mailboxId: s.mailboxId,
        emailId: row.email_id as string,
        delegateId: anna,
        draftActionId: row.depends_on_action_id as string,
        sendActionId: id,
      })
    );
    await db
      .updateTable("actions")
      .set((eb) => ({
        payload: eb.fn("jsonb_set", [
          eb.ref("payload"),
          eb.val(["delegation_id"]),
          eb.val(JSON.stringify(delegationId)),
        ]),
      }))
      .where("id", "=", id)
      .execute();
    const res = await s.app.request(`/api/approvals/${id}/reject`, post("owner", "reject"));
    expect(res.status).toBe(200);
    expect(approvalRejectAnswerSchema.parse(await res.json())).toEqual({ status: "rejected" });
    expect(await send(id)).toMatchObject({ status: "rejected" });
    const delegation = await db
      .selectFrom("delegations")
      .select(["status", "status_reason"])
      .where("id", "=", delegationId)
      .executeTakeFirstOrThrow();
    expect(delegation).toEqual({ status: "cancelled", status_reason: "rejected" });
    const rows = await editRows(s.org.orgId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.dedup_key.endsWith(":rejected"))).toBe(true);
    expect((await auditOf(id)).find((a) => a.event === "action.rejected")?.data).toMatchObject({ via: "web" });
  });

  test("T8. an edit makes version 2 and cleans the text; the old id answers changed on approve and reject", async () => {
    const s = await setup();
    const id = await addSend(s);
    const res = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "Budget 2027", body: "Hello Anna,\r\nplease send the report.\n\nAdam" })
    );
    expect(res.status).toBe(200);
    const answer = approvalEditAnswerSchema.parse(await res.json());
    expect(answer.version).toBe(2);
    expect(answer.id).not.toBe(id);
    expect(await send(id)).toMatchObject({ status: "expired", status_reason: "superseded" });
    const draft = await db
      .selectFrom("actions")
      .select("payload")
      .where("supersedes_action_id", "is not", null)
      .where("type", "=", "create_draft")
      .where("org_id", "=", s.org.orgId)
      .executeTakeFirstOrThrow();
    expect(draft.payload).toMatchObject({
      subject_text: "Budget 2027",
      body_text: "Hello Anna,\nplease send the report.\n\nAdam",
      version: 2,
    });
    for (const route of ["approve", "reject"] as const) {
      const old = await s.app.request(`/api/approvals/${id}/${route}`, post("owner", route));
      expect(old.status).toBe(409);
      expect(approvalConflictSchema.parse(await old.json())).toEqual({ error: "changed", currentId: answer.id });
    }
    const second = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "Budget 2028", body: "Other" })
    );
    expect(second.status).toBe(409);
    expect(approvalConflictSchema.parse(await second.json())).toEqual({ error: "changed", currentId: answer.id });
    expect((await auditOf(answer.id)).some((row) => row.event === "action.approved")).toBe(false);
    expect((await auditOf(answer.id)).find((row) => row.event === "action.edited")?.data).toMatchObject({ via: "web" });
  });

  test("T9. a text that is too long after cleaning, a reminder and the shadow mode", async () => {
    const s = await setup();
    const id = await addSend(s);
    const long = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "S", body: "x".repeat(3001) })
    );
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe("validation");
    // The raw limit is wider than the limit after cleaning: 5000 raw characters that clean to 2500 pass, 7500 never reach the service.
    const bidi = "a\u202e";
    const wide = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "S", body: bidi.repeat(2500) })
    );
    expect(wide.status).toBe(200);
    const raw = await s.app.request(
      `/api/approvals/${approvalEditAnswerSchema.parse(await wide.json()).id}/edit`,
      post("owner", "edit", { subject: "S", body: `${bidi}${"a\u202e\u202e".repeat(2500)}` })
    );
    expect(raw.status).toBe(400);
    expect((await raw.json()).error).toBe("validation");
    const extra = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "S", body: "B", more: 1 })
    );
    expect(extra.status).toBe(400);

    const reminder = await addSend(s, { reminder: 1 });
    const rem = await s.app.request(
      `/api/approvals/${reminder}/edit`,
      post("owner", "edit", { subject: "S", body: "B" })
    );
    expect(rem.status).toBe(400);
    expect(await rem.json()).toEqual({ error: "not_editable" });

    const other = await addSend(s);
    await inTrx((trx) => updateMailboxSettings(trx, s.ctx, s.mailboxId, { mode: "shadow" }));
    const off = await s.app.request(`/api/approvals/${other}/edit`, post("owner", "edit", { subject: "S", body: "B" }));
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({ error: "drafts_off" });
  });

  test("T9b. an inactive delegate and an unchanged text answer 400 with their code; a delegate on a non-delegation kind is 400 validation", async () => {
    const s = await setup();
    const anna = await insertDelegateNow(s, { name: "Anna", active: true });
    const gone = await insertDelegateNow(s, { name: "Gone", active: false });
    const id = await addSend(s, { delegateId: anna });
    const inactive = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "S", body: "B", delegateId: gone })
    );
    expect(inactive.status).toBe(400);
    expect(await inactive.json()).toEqual({ error: "delegate_inactive" });
    const clar = await addSend(s, { kind: "clarification" });
    const wrong = await s.app.request(
      `/api/approvals/${clar}/edit`,
      post("owner", "edit", { subject: "S", body: "B", delegateId: anna })
    );
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error).toBe("validation");
    const first = await s.app.request(`/api/approvals/${id}/edit`, post("owner", "edit", { subject: "S", body: "B" }));
    expect(first.status).toBe(200);
    const { id: newId } = approvalEditAnswerSchema.parse(await first.json());
    const same = await s.app.request(
      `/api/approvals/${newId}/edit`,
      post("owner", "edit", { subject: "S", body: "B" })
    );
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ error: "unchanged" });
  });

  test("T10. a send of another organization: 404 on all three, no change; a bad id is 400 validation", async () => {
    const s = await setup();
    const foreign = await addSend(s, {}, s.org.otherOrgId, s.theirMailboxId);
    for (const route of ROUTES) {
      const res = await s.app.request(`/api/approvals/${foreign}/${route}`, post("owner", route, bodyOf(route)));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
      const bad = await s.app.request(`/api/approvals/not-a-uuid/${route}`, post("owner", route, bodyOf(route)));
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toBe("validation");
    }
    // The other owner still sees and decides its own send.
    expect(await send(foreign)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    expect(await sendCount(s.org.orgId)).toBe(0);
    // The other organization's owner cannot decide this organization's send either.
    const mine = await addSend(s);
    for (const route of ROUTES) {
      const res = await s.app.request(`/api/approvals/${mine}/${route}`, post("other", route, bodyOf(route)));
      expect(res.status).toBe(404);
    }
    expect(await send(mine)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    expect(await editRows(s.org.orgId)).toEqual([]);
    const unknown = await s.app.request(`/api/approvals/${randomUUID()}/approve`, post("owner", "approve"));
    expect(unknown.status).toBe(404);
  });

  test("T10b. a bad delegateId is 400 validation and never reaches Postgres", async () => {
    const s = await setup();
    const id = await addSend(s);
    const res = await s.app.request(
      `/api/approvals/${id}/edit`,
      post("owner", "edit", { subject: "S", body: "B", delegateId: "nope" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation");
    expect(await send(id)).toMatchObject({ status: "awaiting_approval" });
  });

  test("T10c. a body that is not `{}` for approve and reject is 400 validation", async () => {
    const s = await setup();
    const id = await addSend(s);
    for (const route of ["approve", "reject"] as const) {
      const res = await s.app.request(`/api/approvals/${id}/${route}`, post("owner", route, { force: true }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("validation");
    }
    expect(await send(id)).toMatchObject({ status: "awaiting_approval" });
  });

  test("T11. with the flag off all three routes answer 404, also for a bad id", async () => {
    const s = await setup({ flag: false });
    const id = await addSend(s);
    for (const route of ROUTES) {
      for (const target of [id, "nope"]) {
        const res = await s.app.request(`/api/approvals/${target}/${route}`, post("owner", route, bodyOf(route)));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found" });
      }
    }
    // The flag comes before the role: a member gets 404 too, not 403.
    for (const route of ROUTES) {
      const res = await s.app.request(`/api/approvals/${id}/${route}`, post("member", route, bodyOf(route)));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect(await send(id)).toMatchObject({ status: "awaiting_approval", approved_by: null });
    expect(await editRows(s.org.orgId)).toEqual([]);
  });

  test("T12. a foreign Origin is 403 bad_origin; a suspended organization is 403 org_suspended", async () => {
    const s = await setup();
    const id = await addSend(s);
    for (const route of ROUTES) {
      const res = await s.app.request(
        `/api/approvals/${id}/${route}`,
        post("owner", route, bodyOf(route), { origin: "https://evil.example" })
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "bad_origin" });
    }
    expect(TEST_ORIGIN).toBe("http://127.0.0.1:8080");
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", s.org.orgId).execute();
    for (const route of ROUTES) {
      const res = await s.app.request(`/api/approvals/${id}/${route}`, post("owner", route, bodyOf(route)));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "org_suspended" });
    }
    expect(await send(id)).toMatchObject({ status: "awaiting_approval", approved_by: null });
  });

  test("no session: 401 on all three routes", async () => {
    const s = await setup();
    const id = await addSend(s);
    for (const route of ROUTES) {
      const res = await s.app.request(`/api/approvals/${id}/${route}`, {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(401);
    }
  });

  test("the reject of an approved held send works and edits the cards as rejected", async () => {
    const s = await setup({ sendScope: { kind: "off" } });
    const id = await addSend(s);
    await s.app.request(`/api/approvals/${id}/approve`, post("owner", "approve"));
    const res = await s.app.request(`/api/approvals/${id}/reject`, post("owner", "reject"));
    expect(res.status).toBe(200);
    expect(await send(id)).toMatchObject({ status: "rejected" });
  });
});
