import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { insertDraftAndSend } from "./fixtures";
import { testDb } from "./helpers";
import { NOW } from "./reply-job-fixtures";
import { as } from "./web-helpers";
import { post, replyWebKit, type ReplyWorld } from "./web-reply-kit";

// POST /api/approvals/:id/recipients: who receives a reply. The addresses come from the stored mail, never from the request. The
// decisions of the stage 13 review carry-over are tested here: Reply all and the Reply-To, a +tag variant of an own mailbox, a stored
// address with a display name.
const db = testDb();
const kit = replyWebKit(db);

afterEach(async () => {
  await kit.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

interface Detail {
  id: string;
  version: number;
  state: string;
  recipientsMode?: string;
  view: { to?: string[]; cc?: string[]; replyTo?: string[]; canReplyAll?: true; canUseReplyTo?: true };
}
const detailOf = async (w: ReplyWorld, id: string): Promise<Detail> =>
  (await (await w.app.request(`/api/approvals/${id}`, as("owner"))).json()) as Detail;

const sendPayload = async (id: string) =>
  await db
    .selectFrom("actions")
    .select(["payload", "status", "approved_by"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const recipients = (w: ReplyWorld, id: string, body: unknown, who = "owner") =>
  w.app.request(`/api/approvals/${id}/recipients`, post(who, body));

// A drafted reply from anna@client.test with the given stored addresses.
async function drafted(w: ReplyWorld, addresses: Parameters<typeof kit.addresses>[1]) {
  const made = await kit.draftOf(w.box, { from: "anna@client.test" });
  await kit.addresses(made.emailId, addresses);
  return made;
}

describe("the three modes", () => {
  test("1. Reply all: 200 with version 2; To is the sender, Cc the other recipients; the old send is superseded; a second Reply all changes nothing", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, { to: ["b@y.test"], cc: ["c@z.test"] });
    const res = await recipients(w, sendId, { mode: "all" });
    expect(res.status).toBe(200);
    const { id, version } = (await res.json()) as { id: string; version: number };
    expect(version).toBe(2);

    const next = await detailOf(w, id);
    expect(next).toMatchObject({ version: 2, state: "waiting", recipientsMode: "all" });
    expect(next.view.to).toEqual(["anna@client.test"]);
    expect(next.view.cc).toEqual(["b@y.test", "c@z.test"]);
    expect(await sendPayload(id)).toMatchObject({
      payload: { kind: "reply", to: ["anna@client.test"], cc: ["b@y.test", "c@z.test"] },
    });
    expect((await detailOf(w, sendId)).state).toBe("superseded");
    // The change is written as a panel change.
    const edited = await db
      .selectFrom("audit_log")
      .select(["data", "actor"])
      .where("org_id", "=", w.box.ctx.orgId)
      .where("event", "=", "action.edited")
      .execute();
    expect(edited).toEqual([{ actor: w.org.ownerId, data: expect.objectContaining({ via: "web", version: 2 }) }]);

    const same = await recipients(w, id, { mode: "all" });
    expect({ status: same.status, body: await same.json() }).toEqual({ status: 400, body: { error: "unchanged" } });
  });

  test("2. Use Reply-To: To is the first Reply-To address that is not the sender; back to `from` gives the sender only", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, {
      to: ["b@y.test"],
      replyTo: ["anna@client.test", "office@client.test", "second@client.test"],
    });
    const res = await recipients(w, sendId, { mode: "reply_to" });
    const { id } = (await res.json()) as { id: string };
    expect(await sendPayload(id)).toMatchObject({ payload: { to: ["office@client.test"], cc: [] } });
    expect(await detailOf(w, id)).toMatchObject({ recipientsMode: "reply_to" });

    const back = await recipients(w, id, { mode: "from" });
    const { id: third, version } = (await back.json()) as { id: string; version: number };
    expect(version).toBe(3);
    expect(await sendPayload(third)).toMatchObject({ payload: { to: ["anna@client.test"], cc: [] } });
  });

  test("3. the refusals: no_reply_to, no_others, too_many_recipients (11 others), unchanged (`from` on a `from` draft); each a 400 with its code and no new version", async () => {
    const w = await kit.setup();
    const { sendId, emailId } = await drafted(w, { to: [] });
    const cases: [unknown, string][] = [
      [{ mode: "reply_to" }, "no_reply_to"],
      [{ mode: "all" }, "no_others"],
      [{ mode: "from" }, "unchanged"],
    ];
    for (const [body, error] of cases) {
      const res = await recipients(w, sendId, body);
      expect({ body, status: res.status, answer: await res.json() }).toEqual({ body, status: 400, answer: { error } });
    }
    await kit.addresses(emailId, { to: Array.from({ length: 11 }, (_, index) => `p${index}@y.test`) });
    const many = await recipients(w, sendId, { mode: "all" });
    expect({ status: many.status, body: await many.json() }).toEqual({
      status: 400,
      body: { error: "too_many_recipients" },
    });
    await kit.addresses(emailId, { to: Array.from({ length: 10 }, (_, index) => `p${index}@y.test`) });
    expect((await recipients(w, sendId, { mode: "all" })).status).toBe(200);
  });

  test("4. the body is strict: an address, an unknown mode, a missing mode and an extra key answer 400 validation and change nothing", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, { to: ["b@y.test"] });
    for (const body of [
      { mode: "all", to: ["evil@x.test"] },
      { mode: "everyone" },
      {},
      { mode: ["all"] },
      { to: ["evil@x.test"], cc: [] },
    ]) {
      const res = await recipients(w, sendId, body);
      expect({ body, status: res.status, error: ((await res.json()) as { error: string }).error }).toEqual({
        body,
        status: 400,
        error: "validation",
      });
    }
    expect((await detailOf(w, sendId)).state).toBe("waiting");
  });
});

describe("the carry-over decisions of the stage 13 review", () => {
  test("5. Reply all with a different Reply-To goes to the sender and never to the Reply-To; the panel shows both before Send", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, { to: ["b@y.test"], replyTo: ["office@client.test"] });
    const before = await detailOf(w, sendId);
    // The panel sees the Reply-To line and the two buttons before it sends.
    expect(before.view).toMatchObject({ replyTo: ["office@client.test"], canReplyAll: true, canUseReplyTo: true });
    expect(before.recipientsMode).toBe("from");

    const { id } = (await (await recipients(w, sendId, { mode: "all" })).json()) as { id: string };
    const after = await detailOf(w, id);
    expect(after.recipientsMode).toBe("all");
    expect(after.view.to).toEqual(["anna@client.test"]);
    expect(after.view.cc).toEqual(["b@y.test"]);
    expect(JSON.stringify((await sendPayload(id)).payload)).not.toContain("office@client.test");
    // The Reply-To stays on the page: the owner sees where the sender asked for answers, and can choose it.
    expect(after.view).toMatchObject({ replyTo: ["office@client.test"], canUseReplyTo: true });
    expect(after.view.canReplyAll).toBeUndefined();
  });

  test("6. a +tag variant of the own mailbox is no recipient: Reply all leaves it out, and with nothing else the answer is no_others", async () => {
    const w = await kit.setup();
    const [local = "", domain = ""] = w.box.address.split("@");
    const variant = `${local}+news@${domain.toUpperCase()}`;
    const { sendId } = await drafted(w, { to: [w.box.address, variant, "b@y.test"] });
    const { id } = (await (await recipients(w, sendId, { mode: "all" })).json()) as { id: string };
    expect(await sendPayload(id)).toMatchObject({ payload: { to: ["anna@client.test"], cc: ["b@y.test"] } });

    // A mail whose only other recipient is the variant: no button, and the service agrees.
    const second = await drafted(w, { to: [variant], cc: [] });
    expect((await detailOf(w, second.sendId)).view.canReplyAll).toBeUndefined();
    const refused = await recipients(w, second.sendId, { mode: "all" });
    expect({ status: refused.status, body: await refused.json() }).toEqual({
      status: 400,
      body: { error: "no_others" },
    });
  });

  test("7. a stored address with a display name: the button shows only when the service can work, and the service sends to the bare address", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, {
      to: ['"Jan K." <jan@y.test>', "Ola <ola@y.test>"],
      cc: ["Broken <broken>", "no address at all"],
    });
    expect((await detailOf(w, sendId)).view.canReplyAll).toBe(true);
    const res = await recipients(w, sendId, { mode: "all" });
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(await sendPayload(id)).toMatchObject({
      payload: { to: ["anna@client.test"], cc: ["jan@y.test", "ola@y.test"] },
    });

    // Only entries that no draft accepts: no button, and the service agrees.
    const second = await drafted(w, {
      to: ["Broken <broken>", "x@y.test, z@y.test"],
      cc: ["<>"],
      replyTo: ["nonsense"],
    });
    const shown = (await detailOf(w, second.sendId)).view;
    expect(shown.canReplyAll).toBeUndefined();
    expect(shown.canUseReplyTo).toBeUndefined();
    expect(shown.replyTo).toBeUndefined();
    for (const mode of ["all", "reply_to"]) {
      const refused = await recipients(w, second.sendId, { mode });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: mode === "all" ? "no_others" : "no_reply_to" });
    }
  });
});

describe("an old Send and the newer recipients", () => {
  test("8. after Reply all, the old Send answers 409 changed with the newest id and approves nothing; only the new version sends, with its Cc", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, { to: ["b@y.test"] });
    await kit.applyDrafts(w.box);
    const { id } = (await (await recipients(w, sendId, { mode: "all" })).json()) as { id: string };
    await kit.applyDrafts(w.box);

    const old = await w.app.request(`/api/approvals/${sendId}/approve`, post("owner"));
    expect({ status: old.status, body: await old.json() }).toEqual({
      status: 409,
      body: { error: "changed", currentId: id },
    });
    expect(await sendPayload(sendId)).toMatchObject({ status: "expired", approved_by: null, payload: { cc: [] } });

    const fresh = await w.app.request(`/api/approvals/${id}/approve`, post("owner"));
    expect(fresh.status).toBe(200);
    expect(await sendPayload(id)).toMatchObject({
      status: "approved",
      payload: { to: ["anna@client.test"], cc: ["b@y.test"] },
    });
  });

  test("9. a send that was approved answers 409 closed and keeps its recipients; a delegation send answers 404", async () => {
    const w = await kit.setup();
    const { sendId } = await drafted(w, { to: ["b@y.test"] });
    await kit.applyDrafts(w.box);
    expect((await w.app.request(`/api/approvals/${sendId}/approve`, post("owner"))).status).toBe(200);
    const closed = await recipients(w, sendId, { mode: "all" });
    expect({ status: closed.status, body: await closed.json() }).toEqual({
      status: 409,
      body: { error: "closed", state: "held" },
    });
    expect(await sendPayload(sendId)).toMatchObject({ payload: { cc: [] } });

    const other = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, w.box.ctx, w.box.mailboxId, { createdAt: NOW, notifiedAt: NOW }));
    const res = await recipients(w, other.sendId, { mode: "all" });
    expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
  });
});
