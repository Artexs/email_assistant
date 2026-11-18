// The read model and the panel edit of a follow-up. Committed rows; the org is deleted after each test.
import { approvalDetailSchema, approvalListSchema } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { closeLoop } from "../../src/modules/loops";

import { insertFollowUp } from "./follow-up-fixtures";
import { testDb } from "./helpers";
import { approvalKit, NOW, post } from "./web-approvals-kit";
import { as } from "./web-helpers";

const db = testDb();
const kit = approvalKit(db);
afterEach(kit.cleanup);
afterAll(async () => {
  await db.destroy();
});

async function world() {
  const s = await kit.setup();
  const f = await insertFollowUp(db, s.ctx, s.mailboxId, s.org.ownerId, {
    to: ["anna@example.test", "boss@example.test"],
    cc: ["jan@example.test"],
    subject: "Offer Q1",
    createdAt: NOW,
    notifiedAt: NOW,
  });
  return { s, f };
}

const get = async (app: Awaited<ReturnType<typeof world>>["s"]["app"], path: string, who = "owner") => {
  const res = await app.request(path, as(who));
  return { status: res.status, body: (await res.json()) as unknown };
};
const call = async (
  s: Awaited<ReturnType<typeof world>>["s"],
  id: string,
  route: string,
  body: unknown,
  who = "owner"
) => {
  const res = await s.app.request(`/api/approvals/${id}/${route}`, post(who, route, body));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("T5 the list and the detail", () => {
  test("GET /approvals lists a follow-up with its loop id, every recipient, the number and the mailbox of its loop", async () => {
    const { s, f } = await world();
    const answer = await get(s.app, "/api/approvals");
    expect(answer.status).toBe(200);
    const list = approvalListSchema.parse(answer.body);
    expect(list.items).toHaveLength(1);
    const item = list.items[0];
    const mailbox = await db
      .selectFrom("mailboxes")
      .select("address")
      .where("id", "=", s.mailboxId)
      .executeTakeFirstOrThrow();
    expect(item).toMatchObject({
      id: f.sendId,
      kind: "follow_up",
      loopId: f.loopId,
      mailboxAddress: mailbox.address,
      delegationId: null,
      setId: null,
      state: "waiting",
      draftReady: true,
      version: 1,
      heldBy: null,
    });
    expect(item?.view).toMatchObject({
      kind: "follow_up",
      recipient: { name: null, address: "anna@example.test" },
      sender: null,
      to: ["anna@example.test", "boss@example.test"],
      cc: ["jan@example.test"],
      followUpNumber: 1,
      subject: "Re: Offer Q1",
    });
    expect(item?.view.body).toContain("Offer Q1");
    expect(item?.view.quote?.text).toContain("Can you send the numbers by Friday?");
    // Neither another organization nor a mail send sees it; a member reads the list.
    expect(approvalListSchema.parse((await get(s.app, "/api/approvals", "other")).body).items).toEqual([]);
    expect((await get(s.app, "/api/approvals", "member")).status).toBe(200);
  });

  test("GET /approvals/:id gives the detail with the full quote; another organization gets 404", async () => {
    const { s, f } = await world();
    const answer = await get(s.app, `/api/approvals/${f.sendId}`);
    expect(answer.status).toBe(200);
    const detail = approvalDetailSchema.parse(answer.body);
    expect(detail).toMatchObject({
      id: f.sendId,
      kind: "follow_up",
      loopId: f.loopId,
      state: "waiting",
      delegates: [],
    });
    expect(detail.quote).toContain("Can you send the numbers by Friday?");
    expect((await get(s.app, `/api/approvals/${f.sendId}`, "other")).status).toBe(404);
  });

  test("a send whose recipients differ from its loop is shown with the loop's recipients' text, never other ones", async () => {
    const { s, f } = await world();
    // The draft is what the owner sees; the loop row is what the committer checks. A draft with a recipient outside the loop is
    // shown as written (so the owner can reject it); the committer refuses it.
    await db
      .updateTable("actions")
      .set({ payload: JSON.stringify({ ...f.draftPayload, to: ["other@example.test"], cc: [] }) })
      .where(
        "id",
        "=",
        (
          await db
            .selectFrom("actions")
            .select("depends_on_action_id")
            .where("id", "=", f.sendId)
            .executeTakeFirstOrThrow()
        ).depends_on_action_id
      )
      .execute();
    const detail = approvalDetailSchema.parse((await get(s.app, `/api/approvals/${f.sendId}`)).body);
    expect(detail.view?.to).toEqual(["other@example.test"]);
  });
});

describe("T6 the panel edit of a follow-up", () => {
  test("an edit of the body makes a new version on the same loop; recipients, quote and number stay", async () => {
    const { s, f } = await world();
    const answer = await call(s, f.sendId, "edit", {
      subject: "Re: Offer Q1 (reminder)",
      body: "Dear Anna,\n\nany news?\n\nArtek",
    });
    expect(answer).toEqual({ status: 200, body: { id: expect.any(String), version: 2 } });
    const newId = answer.body.id as string;
    const old = await kit.send(f.sendId);
    expect(old).toMatchObject({ status: "expired", status_reason: "superseded" });
    const rows = await db
      .selectFrom("actions")
      .select([
        "id",
        "type",
        "status",
        "email_id",
        "loop_id",
        "supersedes_action_id",
        "payload",
        "depends_on_action_id",
      ])
      .where("org_id", "=", s.org.orgId)
      .where("loop_id", "=", f.loopId)
      .where("status", "in", ["ready", "awaiting_approval"])
      // The edit with UIDPLUS also queues a reverse row that removes the old Drafts copy: it is not the new draft.
      .where("reverses_action_id", "is", null)
      .execute();
    const newSend = rows.find((row) => row.type === "send");
    const newDraft = rows.find((row) => row.type === "create_draft");
    expect(newSend).toMatchObject({
      id: newId,
      status: "awaiting_approval",
      email_id: null,
      loop_id: f.loopId,
      supersedes_action_id: f.sendId,
    });
    expect(newDraft).toMatchObject({ status: "ready", email_id: null, loop_id: f.loopId });
    expect(newSend?.depends_on_action_id).toBe(newDraft?.id ?? "");
    // The reverse row of the old draft is `ready` too and carries the loop: it hangs on the old draft, not on the new one.
    const reverse = await db
      .selectFrom("actions")
      .select(["loop_id", "email_id", "status"])
      .where("org_id", "=", s.org.orgId)
      .where("reverses_action_id", "is not", null)
      .execute();
    expect(reverse).toEqual([{ loop_id: f.loopId, email_id: null, status: "ready" }]);
    expect(newDraft?.payload).toMatchObject({
      kind: "follow_up",
      loop_id: f.loopId,
      to: ["anna@example.test", "boss@example.test"],
      cc: ["jan@example.test"],
      quote: "Can you send the numbers by Friday?",
      n: 1,
      version: 2,
      subject_text: "Re: Offer Q1 (reminder)",
      body_text: "Dear Anna,\n\nany news?\n\nArtek",
    });
    expect(newSend?.payload).toMatchObject({
      kind: "follow_up",
      loop_id: f.loopId,
      to: ["anna@example.test", "boss@example.test"],
      cc: ["jan@example.test"],
    });
    // The audit rows of the edit name the loop.
    const audit = await db
      .selectFrom("audit_log")
      .select(["event", "data"])
      .where("org_id", "=", s.org.orgId)
      .where("event", "in", ["action.expired", "action.edited"])
      .execute();
    expect(audit.map((row) => [row.event, (row.data as Record<string, unknown>).loop_id])).toEqual(
      expect.arrayContaining([
        ["action.expired", f.loopId],
        ["action.edited", f.loopId],
      ])
    );
  });

  test("a delegate id is refused (400 validation); the recipients are never changed by an edit", async () => {
    const { s, f } = await world();
    const answer = await call(s, f.sendId, "edit", {
      subject: "S",
      body: "B",
      delegateId: "11111111-1111-4111-8111-111111111111",
    });
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("validation");
    expect((await kit.send(f.sendId)).status).toBe("awaiting_approval");
    // An extra key that tries to set a recipient is refused by the strict body.
    const forged = await call(s, f.sendId, "edit", { subject: "S", body: "B", to: ["x@example.test"] });
    expect(forged.status).toBe(400);
    expect((await kit.send(f.sendId)).status).toBe("awaiting_approval");
  });

  test("the same text again is `unchanged` (400), a member gets 403, another organization 404", async () => {
    const { s, f } = await world();
    const detail = approvalDetailSchema.parse((await get(s.app, `/api/approvals/${f.sendId}`)).body);
    const same = await call(s, f.sendId, "edit", { subject: detail.view?.subject, body: detail.view?.body });
    expect(same).toEqual({ status: 400, body: { error: "unchanged" } });
    expect((await call(s, f.sendId, "edit", { subject: "S", body: "B" }, "member")).status).toBe(403);
    expect((await call(s, f.sendId, "edit", { subject: "S", body: "B" }, "other")).status).toBe(404);
  });

  test("a loop that closed refuses the edit (409 closed / loop_closed) and changes nothing; after its send ended the state is named", async () => {
    const { s, f } = await world();
    await db.transaction().execute((trx) => closeLoop(trx, s.ctx, { loopId: f.loopId, reason: "replied", at: NOW }));
    const refused = await call(s, f.sendId, "edit", { subject: "S", body: "B" });
    expect(refused).toEqual({ status: 409, body: { error: "closed", state: "loop_closed" } });
    expect(await kit.sendCount(s.org.orgId)).toBe(1);
    expect((await kit.send(f.sendId)).status).toBe("awaiting_approval");
    // The close rules end the send; the edit then names the state of the send.
    await db
      .updateTable("actions")
      .set({ status: "expired", status_reason: "loop_closed" })
      .where("id", "=", f.sendId)
      .execute();
    expect(await call(s, f.sendId, "edit", { subject: "S", body: "B" })).toEqual({
      status: 409,
      body: { error: "closed", state: "expired" },
    });
  });

  test("approve and reject work on a follow-up through the panel; the loop stays open after a reject", async () => {
    const { s, f } = await world();
    const second = await insertFollowUp(db, s.ctx, s.mailboxId, s.org.ownerId, { createdAt: NOW, notifiedAt: NOW });
    expect(await call(s, f.sendId, "approve", {})).toEqual({ status: 200, body: { status: "approved" } });
    expect(await kit.send(f.sendId)).toMatchObject({
      status: "approved",
      approved_by: s.org.ownerId,
      approved_via: "web",
    });
    expect(await call(s, second.sendId, "reject", {})).toEqual({ status: 200, body: { status: "rejected" } });
    expect((await kit.send(second.sendId)).status).toBe("rejected");
    const loop = await db
      .selectFrom("open_loops")
      .select(["status", "follow_ups_sent"])
      .where("id", "=", second.loopId)
      .executeTakeFirstOrThrow();
    expect(loop).toEqual({ status: "open", follow_ups_sent: 0 });
    // The audit rows of both decisions name the loop.
    const audit = await kit.auditOf(f.sendId);
    expect(audit.find((row) => row.event === "action.approved")?.data).toMatchObject({ via: "web", loop_id: f.loopId });
    // A member cannot decide; another organization cannot see it.
    expect((await call(s, second.sendId, "approve", {}, "member")).status).toBe(403);
    expect((await call(s, f.sendId, "reject", {}, "other")).status).toBe(404);
  });

  test("a follow-up has no Send again and no set tap: a forged tap answers like an unknown id", async () => {
    const { s, f } = await world();
    await db
      .updateTable("actions")
      .set({ status: "failed", status_reason: "smtp_error" })
      .where("id", "=", f.sendId)
      .execute();
    const { sendAgain, markWentOut } = await import("../../src/modules/actions");
    const deps = {
      db,
      hooks: (await import("../../src/modules/actions")).noDelegationHooks,
      approvalHooks: { onDecided: async () => undefined },
      uidplus: async () => true,
    };
    expect(await sendAgain(deps, s.ctx, f.sendId, { userId: s.org.ownerId, via: "telegram", now: NOW })).toEqual({
      kind: "not_found",
    });
    expect(await markWentOut(deps, s.ctx, f.sendId, { userId: s.org.ownerId, via: "telegram", now: NOW })).toEqual({
      kind: "not_found",
    });
    expect(await kit.sendCount(s.org.orgId)).toBe(1);
  });
});
