import { newsletterListSchema, type NewsletterList, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";

import { testDb } from "./helpers";
import { addMailbox } from "./trust-fixtures";
import { as } from "./web-helpers";
import {
  addRequest,
  addSenderMail,
  LINK,
  newsletterBox,
  NOW,
  PASS,
  type NewsletterBox,
  type SenderMail,
} from "./web-newsletters-kit";

// GET /api/newsletters/:mailboxId (tests 1 to 3 of the stage file and the rules around them). Committed rows.
const db = testDb();
let box: NewsletterBox;

beforeEach(async () => {
  configureFeatures({ off: [] });
  box = await newsletterBox(db);
});
afterEach(async () => {
  await box.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const mail = (m: SenderMail, mailboxId = box.mailboxId, orgId = box.org.orgId) =>
  addSenderMail(db, orgId, mailboxId, m);
const get = (cookie: string, mailboxId = box.mailboxId, trusted?: readonly string[]) =>
  box.app(trusted).request(`/api/newsletters/${mailboxId}`, as(cookie));

async function listOf(cookie = "owner", mailboxId = box.mailboxId): Promise<NewsletterList> {
  const res = await get(cookie, mailboxId);
  expect(res.status).toBe(200);
  return newsletterListSchema.parse(await res.json());
}

describe("GET /api/newsletters/:mailboxId", () => {
  test("1: a one-click sender and a link sender give two items with the right method; only the link item has a link", async () => {
    await mail({ from: "one@c.example", fromName: "One News", link: LINK, post: true, authResults: PASS, hoursAgo: 5 });
    await mail({ from: "one@c.example", link: LINK, post: true, authResults: PASS, hoursAgo: 30 });
    await mail({ from: "link@c.example", link: LINK, post: false, authResults: PASS, hoursAgo: 2 });
    const { senders } = await listOf();
    expect(senders).toEqual([
      {
        senderLower: "one@c.example",
        fromName: "One News",
        count: 2,
        latestAt: new Date(NOW.getTime() - 5 * HOUR_MS).toISOString(),
        method: "one_click",
        request: null,
      },
      {
        senderLower: "link@c.example",
        fromName: null,
        count: 1,
        latestAt: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString(),
        method: "link",
        request: null,
        linkUrl: "https://u.c.example/unsub?id=1",
      },
    ]);
    expect("linkUrl" in (senders[0] ?? {})).toBe(false);
  });

  test("2: a link that is not an offered https link gives method none: http, mailto, javascript, a user name", async () => {
    for (const [from, link] of [
      ["http@c.example", "<http://u.c.example/x>"],
      ["mailto@c.example", "<mailto:u@c.example>"],
      ["script@c.example", "<javascript:alert(1)>, <data:text/html,x>"],
      ["cred@c.example", "<https://user:pw@u.c.example/x>"],
      ["empty@c.example", null],
    ] as const) {
      await mail({ from, link, post: true, authResults: PASS });
    }
    const { senders } = await listOf();
    expect(senders).toHaveLength(5);
    for (const item of senders) {
      expect(item.method).toBe("none");
      expect("linkUrl" in item).toBe(false);
    }
  });

  test("2b: the first usable https link is offered, in its parsed form; a one-click sender with no trusted id is a link sender", async () => {
    await mail({
      from: "a@c.example",
      link: "<mailto:u@c.example>, <http://x.example/n>, <https://user:pw@bad.example/x>, <HTTPS://U.C.EXAMPLE/a b>",
      post: true,
      authResults: PASS,
    });
    expect((await listOf()).senders[0]).toMatchObject({ method: "one_click" });
    const res = await get("owner", box.mailboxId, []);
    const [item] = newsletterListSchema.parse(await res.json()).senders;
    expect(item).toMatchObject({ method: "link", linkUrl: "https://u.c.example/a%20b" });
  });

  test("3: a foreign mailbox, an unknown id and a bad id answer the same 404; the other owner reads only the own mailbox", async () => {
    await mail({ from: "n@c.example", link: LINK });
    await mail({ from: "o@c.example", link: LINK }, box.otherMailboxId, box.org.otherOrgId);
    const answers = [];
    for (const id of [box.otherMailboxId, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      for (const cookie of ["owner", "member"]) {
        const res = await get(cookie, id);
        answers.push({ status: res.status, body: await res.json() });
      }
    }
    expect(answers).toEqual(Array(6).fill({ status: 404, body: { error: "not_found" } }));
    expect((await listOf("other", box.otherMailboxId)).senders.map((s) => s.senderLower)).toEqual(["o@c.example"]);
    expect((await get("other", box.mailboxId)).status).toBe(404);
    expect((await listOf()).senders.map((s) => s.senderLower)).toEqual(["n@c.example"]);
    expect((await box.app().request(`/api/newsletters/${box.mailboxId}`)).status).toBe(401);
  });

  test("3: with the flag off every role and a bad id get 404; the flag of another organization does not count", async () => {
    await mail({ from: "n@c.example", link: LINK });
    await upsertOrgFeature(
      db,
      { orgId: box.org.orgId },
      { flag: "bulk_unsubscribe", enabled: false, setBy: "test", setAt: NOW }
    );
    for (const [cookie, id] of [
      ["owner", box.mailboxId],
      ["member", box.mailboxId],
      ["owner", "not-a-uuid"],
    ] as const) {
      const res = await get(cookie, id);
      expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
    }
    expect((await get("other", box.otherMailboxId)).status).toBe(200);
  });

  test("4: a member reads the list with no link, also for a sender with a request", async () => {
    await mail({ from: "link@c.example", link: LINK });
    await mail({ from: "one@c.example", link: LINK, post: true, authResults: PASS });
    await addRequest(db, box.org.orgId, box.mailboxId, "one@c.example", { status: "failed" });
    const owner = await listOf("owner");
    const member = await listOf("member");
    expect(owner.senders.map((s) => [s.senderLower, s.linkUrl])).toEqual([
      ["link@c.example", "https://u.c.example/unsub?id=1"],
      ["one@c.example", "https://u.c.example/unsub?id=1"],
    ]);
    expect(member.senders.map((s) => [s.senderLower, s.method, s.request?.status, s.linkUrl])).toEqual([
      ["link@c.example", "link", undefined, undefined],
      ["one@c.example", "one_click", "failed", undefined],
    ]);
  });

  test("5: the request of a sender shows its state and the finish time; a request of another mailbox does not show", async () => {
    await mail({ from: "a@c.example", link: LINK });
    await mail({ from: "b@c.example", link: LINK });
    await mail({ from: "c@c.example", link: LINK });
    await addRequest(db, box.org.orgId, box.mailboxId, "a@c.example", { status: "requested" });
    await addRequest(db, box.org.orgId, box.mailboxId, "b@c.example", { status: "done" });
    const second = await db.transaction().execute((trx) => addMailbox(trx, { orgId: box.org.orgId }));
    await addRequest(db, box.org.orgId, second, "c@c.example", { status: "done" });
    const byId = new Map((await listOf()).senders.map((s) => [s.senderLower, s.request]));
    expect(byId.get("a@c.example")).toEqual({
      status: "requested",
      at: new Date(NOW.getTime() - 2 * HOUR_MS).toISOString(),
      code: null,
    });
    // The code of the request shows too (a short token, never a URL).
    expect(byId.get("b@c.example")).toEqual({
      status: "done",
      at: new Date(NOW.getTime() - HOUR_MS).toISOString(),
      code: "done",
    });
    expect(byId.get("c@c.example")).toBeNull();
  });

  test("6: a long display name is cut by code points; the name is text only (no markup is changed)", async () => {
    const name = `<b>${"😀".repeat(150)}</b>`;
    await mail({ from: "n@c.example", fromName: name, link: LINK });
    const [item] = (await listOf()).senders;
    expect([...(item?.fromName ?? "")]).toHaveLength(100);
    expect(item?.fromName?.startsWith("<b>")).toBe(true);
  });

  test("7: spam and urgent senders are not listed; the answer has only the documented keys", async () => {
    await mail({ from: "spam@c.example", category: "spam", link: LINK });
    await mail({ from: "urgent@c.example", category: "urgent", link: LINK });
    await mail({ from: "ok@c.example", category: "info", link: LINK });
    const res = await get("owner");
    const body = (await res.json()) as { senders: Record<string, unknown>[] };
    expect(body.senders.map((s) => s.senderLower)).toEqual(["ok@c.example"]);
    expect(Object.keys(body)).toEqual(["senders"]);
    expect(Object.keys(body.senders[0] ?? {}).sort()).toEqual([
      "count",
      "fromName",
      "latestAt",
      "linkUrl",
      "method",
      "request",
      "senderLower",
    ]);
  });
});
