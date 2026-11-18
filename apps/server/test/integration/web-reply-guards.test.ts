import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { testDb } from "./helpers";
import { as } from "./web-helpers";
import { post, replyWebKit, type Flags, type ReplyWorld } from "./web-reply-kit";

// The guards of the four reply routes: the two flags, the role, the Origin check, the organization, the body.
const db = testDb();
const kit = replyWebKit(db);

afterEach(async () => {
  await kit.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const NOT_FOUND = { status: 404, body: { error: "not_found" } };

interface Call {
  name: string;
  path: (id: string) => string;
  method: "GET" | "POST";
  body: unknown;
  write: boolean;
}

// The four routes, each with a valid body. `id` is the id of the path (a request id, a send id) or ignored.
const CALLS: Call[] = [
  { name: "POST /api/replies", path: () => "/api/replies", method: "POST", body: { emailId: UNKNOWN }, write: true },
  {
    name: "POST /api/approvals/:id/redraft",
    path: (id) => `/api/approvals/${id}/redraft`,
    method: "POST",
    body: { instruction: "short" },
    write: true,
  },
  {
    name: "POST /api/approvals/:id/recipients",
    path: (id) => `/api/approvals/${id}/recipients`,
    method: "POST",
    body: { mode: "all" },
    write: true,
  },
  {
    name: "GET /api/replies/requests/:id",
    path: (id) => `/api/replies/requests/${id}`,
    method: "GET",
    body: undefined,
    write: false,
  },
];

const call = (w: ReplyWorld, c: Call, who: string, id: string, body: unknown = c.body) =>
  w.app.request(c.path(id), c.method === "GET" ? as(who) : post(who, body));

async function answer(res: Response) {
  return { status: res.status, body: (await res.json()) as unknown };
}

describe("the two flags", () => {
  const OFF: [string, Flags][] = [
    ["approvals_page", { approvals_page: false }],
    ["reply_drafts", { reply_drafts: false }],
    ["both", { approvals_page: false, reply_drafts: false }],
  ];
  for (const [label, flags] of OFF) {
    test(`1. with ${label} off every route answers 404 not_found, as for an unknown id: owner and member, a valid or bad id or a bad body`, async () => {
      const w = await kit.setup();
      const { sendId } = await kit.draftOf(w.box);
      await w.setFlags(flags);
      for (const c of CALLS) {
        for (const who of ["owner", "member"]) {
          expect({ c: c.name, who, ...(await answer(await call(w, c, who, sendId))) }).toEqual({
            c: c.name,
            who,
            ...NOT_FOUND,
          });
          // A bad id or a bad body is no 400 while the feature is off: the routes do not exist yet.
          expect({ c: c.name, ...(await answer(await call(w, c, who, "not-an-id", { bad: true }))) }).toEqual({
            c: c.name,
            ...NOT_FOUND,
          });
        }
      }
    });
  }

  test("2. with a flag off nothing is written: no request row and no new version", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box);
    await w.setFlags({ reply_drafts: false });
    for (const c of CALLS.filter((entry) => entry.write)) {
      await call(w, c, "owner", made.sendId, c.name.endsWith("replies") ? { emailId: made.emailId } : c.body);
    }
    const sends = await db
      .selectFrom("actions")
      .select("id")
      .where("org_id", "=", w.box.ctx.orgId)
      .where("type", "=", "send")
      .execute();
    expect(sends).toHaveLength(1);
    const requests = await db
      .selectFrom("reply_requests")
      .select("trigger")
      .where("org_id", "=", w.box.ctx.orgId)
      .execute();
    expect(requests.map((row) => row.trigger)).toEqual(["auto"]);
  });
});

describe("the role, the session and the Origin check", () => {
  test("3. a member gets 403 owner_only on each write, for an existing and for an unknown id; the read is open to a member", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box);
    for (const c of CALLS.filter((entry) => entry.write)) {
      for (const id of [made.sendId, UNKNOWN]) {
        const res = await answer(
          await call(w, c, "member", id, c.name.endsWith("replies") ? { emailId: made.emailId } : c.body)
        );
        expect({ c: c.name, ...res }).toEqual({ c: c.name, status: 403, body: { error: "owner_only" } });
      }
    }
    const read = await call(w, CALLS[3] as Call, "member", UNKNOWN);
    expect(read.status).toBe(404);
    expect(
      await db
        .selectFrom("reply_requests")
        .select("id")
        .where("trigger", "!=", "auto")
        .where("org_id", "=", w.box.ctx.orgId)
        .execute()
    ).toEqual([]);
  });

  test("4. no session is 401; a foreign Origin is 403 bad_origin and changes nothing, also for the owner of a valid send", async () => {
    const w = await kit.setup();
    const made = await kit.draftOf(w.box);
    for (const c of CALLS) {
      const noCookie = await w.app.request(c.path(made.sendId), {
        method: c.method,
        body: c.body === undefined ? undefined : JSON.stringify(c.body),
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:8080" },
      });
      expect({ c: c.name, status: noCookie.status }).toEqual({ c: c.name, status: 401 });
    }
    for (const c of CALLS.filter((entry) => entry.write)) {
      const body = c.name.endsWith("replies") ? { emailId: made.emailId } : c.body;
      for (const origin of ["https://evil.example", "null"]) {
        const res = await w.app.request(c.path(made.sendId), post("owner", body, { origin }));
        expect({ c: c.name, origin, ...(await answer(res)) }).toEqual({
          c: c.name,
          origin,
          status: 403,
          body: { error: "bad_origin" },
        });
      }
    }
    expect(
      await db
        .selectFrom("reply_requests")
        .select("id")
        .where("trigger", "!=", "auto")
        .where("org_id", "=", w.box.ctx.orgId)
        .execute()
    ).toEqual([]);
    expect(
      await db
        .selectFrom("actions")
        .select("id")
        .where("org_id", "=", w.box.ctx.orgId)
        .where("type", "=", "send")
        .execute()
    ).toHaveLength(1);
  });
});

describe("the organization and the body", () => {
  test("5. the ids of the other organization answer 404 on each route and change nothing there", async () => {
    const w = await kit.setup();
    const theirs = await kit.draftOf(w.theirBox);
    const mail = await kit.mailOf(w.theirBox);
    const request = await db
      .insertInto("reply_requests")
      .values({
        org_id: w.theirBox.ctx.orgId,
        mailbox_id: w.theirBox.mailboxId,
        email_id: mail,
        thread_key: "t",
        folder: "INBOX",
        trigger: "tap",
        requested_by: w.org.otherOwnerId,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const results = [
      await answer(await w.app.request("/api/replies", post("owner", { emailId: mail }))),
      await answer(await w.app.request(`/api/approvals/${theirs.sendId}/redraft`, post("owner", { instruction: "x" }))),
      await answer(await w.app.request(`/api/approvals/${theirs.sendId}/recipients`, post("owner", { mode: "all" }))),
      await answer(await w.app.request(`/api/replies/requests/${request.id}`, as("owner"))),
    ];
    expect(results).toEqual([NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND]);
    const rows = await db
      .selectFrom("reply_requests")
      .select("trigger")
      .where("org_id", "=", w.theirBox.ctx.orgId)
      .orderBy("trigger")
      .execute();
    expect(rows.map((row) => row.trigger)).toEqual(["auto", "tap"]);
    const sends = await db
      .selectFrom("actions")
      .select("id")
      .where("org_id", "=", w.theirBox.ctx.orgId)
      .where("type", "=", "send")
      .execute();
    expect(sends).toHaveLength(1);
  });

  test("6. a bad id in the path or the body is 400 validation; a body that is not JSON, has an extra key or is too long is 400; the raw size cap holds", async () => {
    const w = await kit.setup();
    const bad: [string, unknown][] = [
      ["/api/replies", { emailId: "not-an-id" }],
      ["/api/replies", {}],
      ["/api/replies", { emailId: UNKNOWN, extra: 1 }],
      ["/api/replies", { emailId: UNKNOWN, instruction: "x".repeat(1001) }],
      ["/api/replies", { emailId: UNKNOWN, instruction: 5 }],
      ["/api/replies", { emailId: UNKNOWN, instruction: null }],
      [`/api/approvals/not-an-id/redraft`, { instruction: "x" }],
      [`/api/approvals/not-an-id/recipients`, { mode: "all" }],
      [`/api/approvals/${randomUUID()}/redraft`, []],
    ];
    for (const [path, body] of bad) {
      const res = await w.app.request(path, post("owner", body));
      expect({ path, body, ...(await answer(res)) }).toMatchObject({
        path,
        body,
        status: 400,
        body: { error: "validation" },
      });
    }
    const notJson = await w.app.request("/api/replies", { ...post("owner"), body: "{not json" });
    expect({ status: notJson.status, body: await notJson.json() }).toMatchObject({
      status: 400,
      body: { error: "validation" },
    });
  });
});
