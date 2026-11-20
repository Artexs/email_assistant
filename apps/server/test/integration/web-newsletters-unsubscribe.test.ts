import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

import { configureFeatures, upsertOrgFeature } from "../../src/modules/tenancy";
import { UNSUBSCRIBE_DOMAIN_LIMIT, UNSUBSCRIBE_ORG_LIMIT } from "../../src/modules/triage/newsletter-unsubscribe";
import { postOneClick } from "../../src/platform/public-http";
import { waitFor } from "../wait-for";

import { testDb } from "./helpers";
import { as } from "./web-helpers";
import { addRequest, addSenderMail, LINK, newsletterBox, NOW, PASS, type NewsletterBox } from "./web-newsletters-kit";

// POST /api/newsletters/:mailboxId/unsubscribe (tests 7 to 10 of the stage file and the rules around them).
// Committed rows. The client is a fake: no test sends a real request (the guarded client has its own tests in
// `platform/public-http.test.ts`).
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

const ONE = "one@c.example";
const oneClick = (from = ONE, link: string = LINK) =>
  addSenderMail(db, box.org.orgId, box.mailboxId, {
    from,
    link,
    post: true,
    authResults: `interia.pl; dkim=pass header.d=${from.slice(from.indexOf("@") + 1)}`,
  });
const tap = (cookie: string, sender: string, mailboxId = box.mailboxId) =>
  box.app().request(`/api/newsletters/${mailboxId}/unsubscribe`, as(cookie, { method: "POST", body: { sender } }));
const rows = () =>
  db
    .selectFrom("unsubscribe_requests")
    .selectAll()
    .where("org_id", "=", box.org.orgId)
    .orderBy("sender_lower")
    .execute();
const audits = () =>
  db
    .selectFrom("audit_log")
    .selectAll()
    .where("org_id", "=", box.org.orgId)
    .where("event", "=", "newsletter.unsubscribe")
    .execute();

describe("POST /api/newsletters/:mailboxId/unsubscribe", () => {
  test("7: an owner tap on a one-click sender sends once, ends `done`, and the audit row holds the domain and the code, no URL", async () => {
    await oneClick();
    const res = await tap("owner", ONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "done", code: "http_200", at: NOW.toISOString() });
    expect(box.posts).toEqual(["https://u.c.example/unsub?id=1"]);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      sender_lower: ONE,
      sender_domain: "c.example",
      method: "one_click",
      status: "done",
      code: "http_200",
    });
    expect(stored[0]?.finished_at?.getTime()).toBe(NOW.getTime());
    const logged = await audits();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actor: box.org.ownerId,
      event: "newsletter.unsubscribe",
      data: { mailbox_id: box.mailboxId, domain: "c.example", status: "done", code: "http_200" },
    });
    // The URL is in no stored column and no audit field.
    expect(JSON.stringify([stored, logged])).not.toMatch(/unsub\?id|u\.c\.example|https:/);
  });

  test("8: a second tap is 409 `already_requested` with the stored state, and the client is called once", async () => {
    await oneClick();
    expect((await tap("owner", ONE)).status).toBe(200);
    const again = await tap("owner", ONE);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: "already_requested",
      request: { status: "done", at: NOW.toISOString() },
    });
    expect(box.posts).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  test("8b: a failed request stays failed: the second tap does not send again; the code is stored", async () => {
    await oneClick();
    box.answer.result = { kind: "failed", code: "timeout" };
    const first = await tap("owner", ONE);
    expect(await first.json()).toEqual({ status: "failed", code: "timeout", at: NOW.toISOString() });
    expect((await tap("owner", ONE)).status).toBe(409);
    expect(box.posts).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "failed", code: "timeout" });
  });

  test("8c: a refused target is stored as `refused` with its code", async () => {
    await oneClick();
    box.answer.result = { kind: "refused", code: "private_host" };
    const res = await tap("owner", ONE);
    expect(await res.json()).toEqual({ status: "refused", code: "private_host", at: NOW.toISOString() });
    expect((await audits())[0]).toMatchObject({ data: { status: "refused", code: "private_host" } });
  });

  test("8d: the intent row is committed before the request leaves; two parallel taps send once", async () => {
    await oneClick();
    let reached = false;
    box.answer.onPost = async () => {
      reached = true;
      await Bun.sleep(400);
    };
    const first = tap("owner", ONE);
    await waitFor(() => reached, "the client call");
    expect((await rows())[0]).toMatchObject({ status: "requested", code: null, finished_at: null });
    const second = await tap("owner", ONE);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already_requested", request: { status: "requested" } });
    expect((await first).status).toBe(200);
    expect(box.posts).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "done" });
  });

  test("8e: a crash of the client leaves the row `requested`: the tap is never repeated by itself", async () => {
    await oneClick();
    box.answer.throws = true;
    const res = await tap("owner", ONE);
    expect(res.status).toBe(500);
    expect((await rows())[0]).toMatchObject({ status: "requested", code: null, finished_at: null });
    expect(await audits()).toHaveLength(0);
    box.answer.throws = false;
    expect((await tap("owner", ONE)).status).toBe(409);
    expect(box.posts).toHaveLength(1);
  });

  test("8f: an end state does not overwrite a row that another process already finished, and writes no audit row", async () => {
    await oneClick();
    box.answer.onPost = async () => {
      await db
        .updateTable("unsubscribe_requests")
        .set({ status: "failed", code: "other", finished_at: NOW })
        .where("org_id", "=", box.org.orgId)
        .execute();
    };
    expect((await tap("owner", ONE)).status).toBe(200);
    expect((await rows())[0]).toMatchObject({ status: "failed", code: "other" });
    expect(await audits()).toHaveLength(0);
  });

  test("9: a spam or suspicious sender, an unknown sender and a sender with no one-click are 409 and send nothing", async () => {
    await oneClick("spam@c.example");
    await addSenderMail(db, box.org.orgId, box.mailboxId, {
      from: "spam@c.example",
      category: "spam",
      link: LINK,
      post: true,
      authResults: PASS,
    });
    await addSenderMail(db, box.org.orgId, box.mailboxId, {
      from: "link@c.example",
      link: LINK,
      post: false,
      authResults: PASS,
    });
    const answers: [number, unknown][] = [];
    for (const sender of ["spam@c.example", "nobody@c.example", "link@c.example"]) {
      const res = await tap("owner", sender);
      answers.push([res.status, await res.json()]);
    }
    expect(answers).toEqual([
      [409, { error: "not_allowed" }],
      [409, { error: "not_allowed" }],
      [409, { error: "no_one_click" }],
    ]);
    expect(box.posts).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  test("9b: a sender whose Authentication-Results is not trusted (an untrusted top header, a trusted name in a comment or a value) is 409 `no_one_click`", async () => {
    const spoofed = [
      "evil.example; dkim=pass header.d=c.example",
      "evil.example (interia.pl); dkim=pass header.d=c.example",
      "evil.example; dkim=pass header.d=c.example; x-note=interia.pl",
      "interia.pl; dkim=fail header.d=c.example",
      "interia.pl; dkim=pass header.d=evil.example",
    ];
    for (const [index, authResults] of spoofed.entries()) {
      const from = `s${index}@c.example`;
      await addSenderMail(db, box.org.orgId, box.mailboxId, { from, link: LINK, post: true, authResults });
      const res = await tap("owner", from);
      expect({ authResults, status: res.status, body: await res.json() }).toEqual({
        authResults,
        status: 409,
        body: { error: "no_one_click" },
      });
    }
    expect(box.posts).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  test("9c: the request goes to the link of the newest mail, and the sender is matched without case", async () => {
    await oneClick(ONE, "<https://old.c.example/u>");
    await addSenderMail(db, box.org.orgId, box.mailboxId, {
      from: ONE,
      link: "<https://new.c.example/u>",
      post: true,
      authResults: PASS,
      hoursAgo: 0.5,
    });
    expect((await tap("owner", "  ONE@C.example ")).status).toBe(200);
    expect(box.posts).toEqual(["https://new.c.example/u"]);
    expect((await rows())[0]?.sender_lower).toBe(ONE);
  });

  test("10: a member is 403, a flag that is off is 404 for every role, another organization and a bad id are 404, a bad body is 400", async () => {
    await oneClick();
    const member = await tap("member", ONE);
    expect([member.status, await member.json()]).toEqual([403, { error: "owner_only" }]);
    expect((await tap("other", ONE)).status).toBe(404);
    expect((await tap("owner", ONE, box.otherMailboxId)).status).toBe(404);
    expect((await tap("owner", ONE, "not-a-uuid")).status).toBe(404);
    const noBody = await box
      .app()
      .request(`/api/newsletters/${box.mailboxId}/unsubscribe`, as("owner", { method: "POST", body: {} }));
    expect(noBody.status).toBe(400);
    const extra = await box
      .app()
      .request(
        `/api/newsletters/${box.mailboxId}/unsubscribe`,
        as("owner", { method: "POST", body: { sender: ONE, url: "https://evil.example/" } })
      );
    expect(extra.status).toBe(400);
    expect(box.posts).toEqual([]);

    await upsertOrgFeature(
      db,
      { orgId: box.org.orgId },
      { flag: "bulk_unsubscribe", enabled: false, setBy: "test", setAt: NOW }
    );
    for (const cookie of ["owner", "member"]) {
      const res = await tap(cookie, ONE);
      expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
    }
    expect(box.posts).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  test("11: at most 3 requests per sender domain and 20 per organization in an hour; an older row does not count", async () => {
    const recent = new Date(NOW.getTime() - 10 * MINUTE_MS);
    // Two earlier requests of the domain in the last hour (rows of other senders) and one from 2 h ago.
    await addRequest(db, box.org.orgId, box.mailboxId, "a@d.example", { status: "done", createdAt: recent });
    await addRequest(db, box.org.orgId, box.mailboxId, "b@d.example", { status: "done", createdAt: recent });
    await addRequest(db, box.org.orgId, box.mailboxId, "old@d.example", { status: "done" });
    for (const from of ["c@d.example", "d@d.example"]) await oneClick(from);
    expect(UNSUBSCRIBE_DOMAIN_LIMIT).toBe(3);
    expect((await tap("owner", "c@d.example")).status).toBe(200);
    const blocked = await tap("owner", "d@d.example");
    expect([blocked.status, await blocked.json()]).toEqual([429, { error: "rate_limited" }]);
    expect(box.posts).toHaveLength(1);
    expect((await rows()).find((row) => row.sender_lower === "d@d.example")).toBeUndefined();
    // Another domain is not limited by it.
    await oneClick("x@e.example");
    expect((await tap("owner", "x@e.example")).status).toBe(200);
  });

  test("11b: the organization limit counts every domain", async () => {
    const recent = new Date(NOW.getTime() - 5 * MINUTE_MS);
    expect(UNSUBSCRIBE_ORG_LIMIT).toBe(20);
    for (let i = 0; i < UNSUBSCRIBE_ORG_LIMIT; i += 1)
      await addRequest(db, box.org.orgId, box.mailboxId, `s@d${i}.example`, { status: "done", createdAt: recent });
    await oneClick("fresh@z.example");
    const res = await tap("owner", "fresh@z.example");
    expect([res.status, await res.json()]).toEqual([429, { error: "rate_limited" }]);
    expect(box.posts).toEqual([]);
  });

  test("11e: a sender that has a request is 409 `already_requested` also when the limit is reached (the stored state wins over the limit)", async () => {
    const recent = new Date(NOW.getTime() - 5 * MINUTE_MS);
    for (const from of ["a@d.example", "b@d.example", "c@d.example"])
      await addRequest(db, box.org.orgId, box.mailboxId, from, { status: "done", createdAt: recent });
    await oneClick("c@d.example");
    const res = await tap("owner", "c@d.example");
    expect([res.status, await res.json()]).toMatchObject([409, { error: "already_requested" }]);
    expect(box.posts).toEqual([]);
  });

  test("11d: parallel taps cannot pass the limit of a domain (one writer per organization)", async () => {
    const senders = Array.from({ length: 8 }, (_, i) => `p${i}@d.example`);
    for (const from of senders) await oneClick(from);
    const answers = await Promise.all(senders.map((sender) => tap("owner", sender)));
    expect(answers.map((res) => res.status).sort()).toEqual([200, 200, 200, 429, 429, 429, 429, 429]);
    expect(box.posts).toHaveLength(UNSUBSCRIBE_DOMAIN_LIMIT);
    expect(await rows()).toHaveLength(UNSUBSCRIBE_DOMAIN_LIMIT);
  });

  test("11c: the limit of another organization does not count", async () => {
    const recent = new Date(NOW.getTime() - 5 * MINUTE_MS);
    await addSenderMail(db, box.org.otherOrgId, box.otherMailboxId, { from: "t@c.example" });
    for (let i = 0; i < 3; i += 1)
      await addRequest(db, box.org.otherOrgId, box.otherMailboxId, `s${i}@c.example`, {
        status: "done",
        createdAt: recent,
      });
    await oneClick();
    expect((await tap("owner", ONE)).status).toBe(200);
  });

  test("12: after a tap the list shows the state and, for the owner, the link of the page", async () => {
    await oneClick();
    await tap("owner", ONE);
    const res = await box.app().request(`/api/newsletters/${box.mailboxId}`, as("owner"));
    const body = (await res.json()) as {
      senders: { senderLower: string; request: { status: string } | null; linkUrl?: string }[];
    };
    expect(body.senders[0]).toMatchObject({
      senderLower: ONE,
      request: { status: "done" },
      linkUrl: "https://u.c.example/unsub?id=1",
    });
    const asMember = await box.app().request(`/api/newsletters/${box.mailboxId}`, as("member"));
    expect(JSON.stringify(await asMember.json())).not.toContain("u.c.example");
  });
});

// The REAL client behind the route. The lookup is a stub and the dialer throws: a refused target must end
// `refused` with its stored code and reach neither. Nothing here opens a connection.
describe("the real guarded client behind the route", () => {
  test("13: a metadata address, an IPv4-mapped literal and port 8443 end `refused`: the stored code, 0 lookups, 0 dials", async () => {
    let lookups = 0;
    let dials = 0;
    const real = (url: URL) =>
      postOneClick(url, {
        lookup: async () => {
          lookups += 1;
          return [{ address: "93.184.216.34", family: 4 }];
        },
        dial: async () => {
          dials += 1;
          throw new Error("the dialer must not be called");
        },
      });
    await box.cleanup();
    box = await newsletterBox(db, { post: real });
    const cases = [
      ["m@c.example", "<https://169.254.169.254/x>", "private_host"],
      ["v6@c.example", "<https://[::ffff:a00:5]/>", "private_host"],
      ["port@c.example", "<https://u.c.example:8443/x>", "port"],
    ] as const;
    for (const [from, link, code] of cases) {
      await oneClick(from, link);
      const res = await tap("owner", from);
      expect({ from, status: res.status, body: await res.json() }).toEqual({
        from,
        status: 200,
        body: { status: "refused", code, at: NOW.toISOString() },
      });
    }
    const refused = (await rows()).map((row) => [row.sender_lower, row.status, row.code]);
    expect(refused).toEqual(
      cases.map(([from, , code]) => [from, "refused", code]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1))
    );
    expect(await audits()).toHaveLength(3);
    expect({ lookups, dials }).toEqual({ lookups: 0, dials: 0 });

    // A public name does reach the lookup, then the dialer: the stubs are live (the counts above are not zero by accident).
    await oneClick("ok@d.example", "<https://u.d.example/x>");
    expect((await tap("owner", "ok@d.example")).status).toBe(200);
    expect({ lookups, dials }).toEqual({ lookups: 1, dials: 1 });
    expect((await rows()).find((row) => row.sender_lower === "ok@d.example")).toMatchObject({
      status: "failed",
      code: "network",
    });
  });
});
