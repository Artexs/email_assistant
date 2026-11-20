import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { getUserRequest, replyVersionFacts } from "../../src/modules/replies";

import { insertDraftAndSend } from "./fixtures";
import { testDb } from "./helpers";
import { NOW } from "./reply-job-fixtures";
import { as } from "./web-helpers";
import { post, replyWebKit, type ReplyWorld } from "./web-reply-kit";

// What the approvals page reads for a reply (the facts of a reply come from the payload and the request rows), the edit of a reply, and
// the status route that the panel polls: scoped to the organization and to the mailbox of the request.
const db = testDb();
const kit = replyWebKit(db);

afterEach(async () => {
  await kit.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const GAP_ANSWER = {
  decision: "draft",
  reason_code: null,
  body: "Dzień dobry,\n\nCena to [[kwota]] zł.",
  gaps: ["kwota"],
  language: "pl",
};

interface Item {
  id: string;
  kind: string;
  version: number;
  instruction?: string | null;
  redraftsLeft?: number;
  recipientsMode?: string;
  view: { gaps?: string[]; cc?: string[]; replyTo?: string[]; subject: string; body: string; sentVisible?: false };
}
const getItem = async (w: ReplyWorld, id: string) =>
  (await (await w.app.request(`/api/approvals/${id}`, as("owner"))).json()) as Item;

describe("the read model of a reply", () => {
  test("1. a reply with a gap: gaps, redraftsLeft 5, no instruction, the mode `from`; the list item has the same facts", async () => {
    const w = await kit.setup();
    const emailId = await kit.mailOf(w.box);
    await w.app.request("/api/replies", post("owner", { emailId }));
    await kit.runDrafter(w.box, GAP_ANSWER);
    const [row] = await db
      .selectFrom("actions")
      .select("id")
      .where("org_id", "=", w.box.ctx.orgId)
      .where("type", "=", "send")
      .execute();
    const id = row?.id ?? "";

    const detail = await getItem(w, id);
    expect(detail).toMatchObject({
      kind: "reply",
      version: 1,
      instruction: null,
      redraftsLeft: 5,
      recipientsMode: "from",
    });
    expect(detail.view.gaps).toEqual(["kwota"]);
    const list = (await (await w.app.request("/api/approvals", as("member"))).json()) as { items: Item[] };
    expect(list.items.find((item) => item.id === id)).toMatchObject({
      redraftsLeft: 5,
      instruction: null,
      recipientsMode: "from",
    });
  });

  test("2. a delegation item has none of the reply keys", async () => {
    const w = await kit.setup();
    const made = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, w.box.ctx, w.box.mailboxId, { createdAt: NOW, notifiedAt: NOW }));
    const detail = await getItem(w, made.sendId);
    for (const key of ["instruction", "redraftsLeft", "recipientsMode"]) expect(detail).not.toHaveProperty(key);
    const list = (await (await w.app.request("/api/approvals", as("owner"))).json()) as { items: Item[] };
    const item = list.items.find((entry) => entry.id === made.sendId);
    expect(item).toBeDefined();
    for (const key of ["instruction", "redraftsLeft", "recipientsMode"]) expect(item).not.toHaveProperty(key);
  });

  test("3. each redraft request counts, also a failed one, and only the requests of this mail; the line is the line of the request that made this version", async () => {
    const w = await kit.setup();
    const first = await kit.draftOf(w.box);
    const other = await kit.draftOf(w.box);
    const redraft = (sendId: string, instruction: string) =>
      w.app.request(`/api/approvals/${sendId}/redraft`, post("owner", { instruction }));
    expect((await redraft(first.sendId, "shorter")).status).toBe(202);
    await kit.runDrafter(w.box);
    const [made] = await db
      .selectFrom("reply_requests")
      .select(["send_action_id", "instruction"])
      .where("org_id", "=", w.box.ctx.orgId)
      .where("email_id", "=", first.emailId)
      .where("trigger", "=", "redraft")
      .execute();
    expect(made?.instruction).toBe("shorter");
    expect(await getItem(w, made?.send_action_id ?? "")).toMatchObject({ instruction: "shorter", redraftsLeft: 4 });
    // The other mail is not touched by the redrafts of the first.
    expect(await getItem(w, other.sendId)).toMatchObject({ instruction: null, redraftsLeft: 5 });
    // A request that failed counts too (the limit counts it).
    await db
      .insertInto("reply_requests")
      .values({
        org_id: w.box.ctx.orgId,
        mailbox_id: w.box.mailboxId,
        email_id: other.emailId,
        thread_key: "t",
        folder: "INBOX",
        trigger: "redraft",
        status: "failed",
        requested_by: w.org.ownerId,
      })
      .execute();
    expect((await getItem(w, other.sendId)).redraftsLeft).toBe(4);
    // Retention clears the line: the page shows none.
    await db.updateTable("reply_requests").set({ instruction: null }).where("email_id", "=", first.emailId).execute();
    expect((await getItem(w, made?.send_action_id ?? "")).instruction).toBeNull();
  });
});

describe("the edit of a reply (POST /api/approvals/:id/edit)", () => {
  test("4. a new text keeps To and Cc and the mode; the gaps follow the text; a text with a gap cannot be approved", async () => {
    const w = await kit.setup();
    const { sendId, emailId } = await kit.draftOf(w.box, { from: "anna@client.test" });
    await kit.addresses(emailId, { to: ["b@y.test"] });
    const all = await w.app.request(`/api/approvals/${sendId}/recipients`, post("owner", { mode: "all" }));
    const { id } = (await all.json()) as { id: string };
    const before = await getItem(w, id);

    const edit = (sendFrom: string, body: string) =>
      w.app.request(`/api/approvals/${sendFrom}/edit`, post("owner", { subject: before.view.subject, body }));
    const gap = await edit(id, "Dzień dobry, kwota: [[kwota]].");
    expect(gap.status).toBe(200);
    const { id: gapId, version } = (await gap.json()) as { id: string; version: number };
    expect(version).toBe(3);
    const gapItem = await getItem(w, gapId);
    expect(gapItem).toMatchObject({ recipientsMode: "all", redraftsLeft: 5 });
    expect(gapItem.view).toMatchObject({ gaps: ["kwota"], cc: ["b@y.test"] });
    const row = await db.selectFrom("actions").select("payload").where("id", "=", gapId).executeTakeFirstOrThrow();
    expect(row.payload).toMatchObject({ to: ["anna@client.test"], cc: ["b@y.test"] });

    await kit.applyDrafts(w.box);
    const refused = await w.app.request(`/api/approvals/${gapId}/approve`, post("owner"));
    expect({ status: refused.status, body: await refused.json() }).toEqual({
      status: 409,
      body: { error: "has_gaps" },
    });

    const filled = await edit(gapId, "Dzień dobry, kwota: 100 zł.");
    const { id: filledId } = (await filled.json()) as { id: string };
    const filledItem = await getItem(w, filledId);
    expect(filledItem.view.gaps ?? []).toEqual([]);
    expect(filledItem.version).toBe(4);
  });
});

describe("GET /api/replies/requests/:id", () => {
  const status = (w: ReplyWorld, id: string, who = "owner") => w.app.request(`/api/replies/requests/${id}`, as(who));

  test("5. the answer of each end: failed and no_draft carry their code and no send; the instruction is never in the answer", async () => {
    const w = await kit.setup();
    const emailId = await kit.mailOf(w.box);
    const ended = async (state: string, reason: string | null) => {
      const row = await db
        .insertInto("reply_requests")
        .values({
          org_id: w.box.ctx.orgId,
          mailbox_id: w.box.mailboxId,
          email_id: emailId,
          thread_key: "t",
          folder: "INBOX",
          trigger: "tap",
          status: state,
          reason_code: reason,
          instruction: "SECRET-LINE-9",
          requested_by: w.org.ownerId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const res = await status(w, row.id, "member");
      const text = await res.text();
      expect(text).not.toContain("SECRET-LINE");
      return JSON.parse(text) as unknown;
    };
    expect(await ended("failed", "llm_cap")).toEqual({ status: "failed", reasonCode: "llm_cap", sendId: null });
    expect(await ended("no_draft", "needs_facts")).toEqual({
      status: "no_draft",
      reasonCode: "needs_facts",
      sendId: null,
    });
    expect(await ended("drafting", null)).toEqual({ status: "drafting", reasonCode: null, sendId: null });
    expect(await ended("cancelled", null)).toEqual({ status: "cancelled", reasonCode: null, sendId: null });
  });

  test("6. a request of the other organization, an unknown id and an automatic request answer 404; a bad id answers 400", async () => {
    const w = await kit.setup();
    const theirMail = await kit.mailOf(w.theirBox);
    const myMail = await kit.mailOf(w.box);
    const theirs = await db
      .insertInto("reply_requests")
      .values({
        org_id: w.theirBox.ctx.orgId,
        mailbox_id: w.theirBox.mailboxId,
        email_id: theirMail,
        thread_key: "t",
        folder: "INBOX",
        trigger: "tap",
        requested_by: w.org.otherOwnerId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const auto = await db
      .insertInto("reply_requests")
      .values({
        org_id: w.box.ctx.orgId,
        mailbox_id: w.box.mailboxId,
        email_id: myMail,
        thread_key: "t",
        folder: "INBOX",
        trigger: "auto",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    for (const id of [theirs.id, auto.id, "00000000-0000-4000-8000-000000000000"]) {
      const res = await status(w, id);
      expect({ id, status: res.status, body: await res.json() }).toEqual({
        id,
        status: 404,
        body: { error: "not_found" },
      });
    }
    expect((await status(w, "not-an-id")).status).toBe(400);
  });

  test("7. superseded names the open reply of the thread of the same mailbox, not one of another mailbox with the same thread key", async () => {
    const w = await kit.setup();
    const thread = "<thread-shared@x.test>";
    const lost = await kit.mailOf(w.box, { threadKey: thread, receivedAt: new Date(NOW.getTime() - HOUR_MS) });
    const newer = await kit.draftOf(w.box, { threadKey: thread, receivedAt: new Date(NOW.getTime() - MINUTE_MS) });
    // The same thread key in a second mailbox of the organization, with its own open reply.
    const otherMailbox = await kit.addMailbox(w.box.ctx.orgId);
    const sameThread = await kit.draftOf(
      { ...w.box, mailboxId: otherMailbox.id, address: otherMailbox.address },
      { threadKey: thread, receivedAt: new Date(NOW.getTime() - 30_000) }
    );
    const request = await db
      .insertInto("reply_requests")
      .values({
        org_id: w.box.ctx.orgId,
        mailbox_id: w.box.mailboxId,
        email_id: lost,
        thread_key: thread,
        folder: "INBOX",
        trigger: "tap",
        status: "superseded",
        requested_by: w.org.ownerId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const res = await status(w, request.id);
    expect(await res.json()).toEqual({ status: "superseded", reasonCode: null, sendId: newer.sendId });
    expect(sameThread.sendId).not.toBe(newer.sendId);
  });

  test("7b. superseded with no open reply in the thread answers sendId null; a closed reply is not named", async () => {
    const w = await kit.setup();
    const thread = "<thread-closed@x.test>";
    const lost = await kit.mailOf(w.box, { threadKey: thread, receivedAt: new Date(NOW.getTime() - HOUR_MS) });
    const newer = await kit.draftOf(w.box, { threadKey: thread, receivedAt: new Date(NOW.getTime() - MINUTE_MS) });
    const request = await db
      .insertInto("reply_requests")
      .values({
        org_id: w.box.ctx.orgId,
        mailbox_id: w.box.mailboxId,
        email_id: lost,
        thread_key: thread,
        folder: "INBOX",
        trigger: "tap",
        status: "superseded",
        requested_by: w.org.ownerId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    expect(await (await status(w, request.id)).json()).toEqual({
      status: "superseded",
      reasonCode: null,
      sendId: newer.sendId,
    });

    await db.updateTable("actions").set({ status: "rejected" }).where("id", "=", newer.sendId).execute();

    expect(await (await status(w, request.id)).json()).toEqual({
      status: "superseded",
      reasonCode: null,
      sendId: null,
    });
  });
});

// The route runs in the tenant scope of the session, so the database policy hides another organization's rows before the query filter
// matters. These calls run with no scope: only the `org_id` filter of the query keeps another organization out.
describe("the readers filter by organization on their own", () => {
  test("8. getUserRequest and replyVersionFacts answer nothing for the other organization's context", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box);
    const asked = await w.app.request(
      `/api/approvals/${made.sendId}/redraft`,
      post("owner", { instruction: "shorter" })
    );
    const { requestId } = (await asked.json()) as { requestId: string };
    await kit.runDrafter(w.box);
    const [done] = await db.selectFrom("reply_requests").select("send_action_id").where("id", "=", requestId).execute();
    const mine = w.box.ctx;
    const theirs = w.theirBox.ctx;

    expect(await getUserRequest(db, mine, requestId)).toMatchObject({ status: "done", emailId: made.emailId });
    expect(await getUserRequest(db, theirs, requestId)).toBeUndefined();
    const sendId = done?.send_action_id ?? "";
    expect(await replyVersionFacts(db, mine, { sendId, emailId: made.emailId })).toEqual({
      instruction: "shorter",
      redrafts: 1,
    });
    expect(await replyVersionFacts(db, theirs, { sendId, emailId: made.emailId })).toEqual({
      instruction: null,
      redrafts: 0,
    });
  });
});
