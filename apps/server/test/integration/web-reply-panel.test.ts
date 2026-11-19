import { approvalEndReasons } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { listOpenReplySendIdsOfEmails } from "../../src/modules/actions";
import { closeSendReasons } from "../../src/modules/actions/close";

import { testDb } from "./helpers";
import { as } from "./web-helpers";
import { post, replyWebKit, type ReplyWorld } from "./web-reply-kit";

// What the panel reads for the reply kind beyond the approvals routes: the `reply` key of the activity rows (the "Draft reply" button
// and the link to the open draft) and the `endReason` of a send that the system closed.
const db = testDb();
const kit = replyWebKit(db);

afterEach(async () => {
  await kit.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

interface Row {
  emailId: string;
  reply?: { sendId: string | null };
}
const rowsOf = async (w: ReplyWorld, who = "owner"): Promise<Row[]> =>
  ((await (await w.app.request("/api/activity", as(who))).json()) as { items: Row[] }).items;
const replyOf = async (w: ReplyWorld, emailId: string) =>
  (await rowsOf(w)).find((row) => row.emailId === emailId)?.reply;

describe("the reply key of an activity row", () => {
  test("1. with the flag on: the id of the open draft, or null; a closed draft is not named; the key is absent with the flag off", async () => {
    const w = await kit.setup();
    const plain = await kit.mailOf(w.box);
    const drafted = await kit.draftOf(w.box);

    expect(await replyOf(w, plain)).toEqual({ sendId: null });
    expect(await replyOf(w, drafted.emailId)).toEqual({ sendId: drafted.sendId });

    await db.updateTable("actions").set({ status: "rejected" }).where("id", "=", drafted.sendId).execute();
    expect(await replyOf(w, drafted.emailId)).toEqual({ sendId: null });

    await w.setFlags({ reply_drafts: false });
    const rows = await rowsOf(w);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row, "no key with the flag off").not.toHaveProperty("reply");
  });

  test("2. a draft of another organization is never named; a send that is no reply is not named", async () => {
    const w = await kit.setup();
    const mine = await kit.mailOf(w.box);
    const theirs = await kit.draftOf(w.theirBox);

    expect(await replyOf(w, mine)).toEqual({ sendId: null });
    expect((await rowsOf(w)).some((row) => row.emailId === theirs.emailId)).toBe(false);

    // No tenant scope here: only the `org_id` filter of the reader keeps the other organization out.
    expect([...(await listOpenReplySendIdsOfEmails(db, w.box.ctx, [theirs.emailId]))]).toEqual([]);
    expect([...(await listOpenReplySendIdsOfEmails(db, w.theirBox.ctx, [theirs.emailId]))]).toEqual([
      [theirs.emailId, theirs.sendId],
    ]);

    const other = await kit.draftOf(w.box);
    await db
      .updateTable("actions")
      .set({ payload: { kind: "delegation" } })
      .where("id", "=", other.sendId)
      .execute();
    expect(await replyOf(w, other.emailId)).toEqual({ sendId: null });
  });
});

describe("the end reason of a closed send", () => {
  test("3. an expired send names the reason that the system closed it with; a timeout names none; the lists are the same", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box);
    const read = async () =>
      (await (await w.app.request(`/api/approvals/${made.sendId}`, as("owner"))).json()) as {
        state: string;
        endReason?: string;
      };
    for (const reason of approvalEndReasons) {
      await db
        .updateTable("actions")
        .set({ status: "expired", status_reason: reason })
        .where("id", "=", made.sendId)
        .execute();
      expect(await read(), reason).toMatchObject({ state: "expired", endReason: reason });
    }
    await db
      .updateTable("actions")
      .set({ status: "expired", status_reason: "timeout" })
      .where("id", "=", made.sendId)
      .execute();
    const timed = await read();
    expect(timed.state).toBe("expired");
    expect(timed).not.toHaveProperty("endReason");

    // Another state names none, whatever its reason text says.
    await db
      .updateTable("actions")
      .set({ status: "failed", status_reason: "answered" })
      .where("id", "=", made.sendId)
      .execute();
    const failed = await read();
    expect(failed.state).toBe("failed");
    expect(failed).not.toHaveProperty("endReason");

    expect([...approvalEndReasons].sort()).toEqual([...closeSendReasons].sort());
  });
});

describe("the addresses that Reply all would add", () => {
  const addsOf = async (w: ReplyWorld, id: string) =>
    ((await (await w.app.request(`/api/approvals/${id}`, as("owner"))).json()) as { replyAllAdds?: string[] })
      .replyAllAdds;

  test("4. listed while the button shows: the others of To and Cc without own mailboxes, the sender and doubles; none after Reply all, none for 11 others", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box, { from: "anna@client.test" });
    await kit.addresses(made.emailId, {
      to: [w.box.address, "Anna <anna@client.test>", "b@y.test"],
      cc: ["c@z.test", "B@Y.test"],
    });
    expect(await addsOf(w, made.sendId)).toEqual(["b@y.test", "c@z.test"]);
    const list = (await (await w.app.request("/api/approvals", as("owner"))).json()) as {
      items: { id: string; replyAllAdds?: string[] }[];
    };
    expect(list.items.find((item) => item.id === made.sendId)?.replyAllAdds).toEqual(["b@y.test", "c@z.test"]);

    await kit.addresses(made.emailId, {
      to: [w.box.address, ...Array.from({ length: 11 }, (_, index) => `p${index}@y.test`)],
    });
    expect(await addsOf(w, made.sendId)).toBeUndefined();

    await kit.addresses(made.emailId, { to: [w.box.address] });
    expect(await addsOf(w, made.sendId)).toBeUndefined();
  });

  test("4b. after Reply all the new version lists none (its Cc has them already), and the old version is superseded", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box, { from: "anna@client.test" });
    await kit.addresses(made.emailId, { to: [w.box.address, "b@y.test"], cc: ["c@z.test"] });
    expect(await addsOf(w, made.sendId)).toEqual(["b@y.test", "c@z.test"]);

    const done = await w.app.request(`/api/approvals/${made.sendId}/recipients`, post("owner", { mode: "all" }));
    expect(done.status).toBe(200);
    const { id } = (await done.json()) as { id: string };

    expect(id).not.toBe(made.sendId);
    expect(await addsOf(w, id)).toBeUndefined();
    const item = (await (await w.app.request(`/api/approvals/${id}`, as("owner"))).json()) as {
      recipientsMode: string;
      view: { cc: string[]; canReplyAll?: true };
    };
    expect(item.recipientsMode).toBe("all");
    expect(item.view.cc).toEqual(["b@y.test", "c@z.test"]);
    expect(item.view.canReplyAll).toBeUndefined();
  });
});
