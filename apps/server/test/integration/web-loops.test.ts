import { loopListSchema, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { loopRoutes } from "../../src/modules/loops";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createDb } from "../../src/platform/db";

import { testDb } from "./helpers";
import { actionsOfLoop, ANNA, auditOf, commandLoop, FRIDAY, loopOf } from "./loops-commands-fixtures";
import { TEST_ORIGIN } from "./web-helpers";
import { call, loopApp, loopWorld, type LoopWorld } from "./web-loops-fixtures";

// The loop routes. Every route is one call of a loop command with `via: "web"`. The commands have
// their own tests (`loops-commands.test.ts`, `loops-follow-up-draft.test.ts`, `loops-delegate.test.ts`); these tests check the
// roles, the flags, the answers and the tenancy of the routes.
const db = testDb();
const ownerUrl = process.env.MIGRATOR_DATABASE_URL;
if (!ownerUrl)
  throw new Error("MIGRATOR_DATABASE_URL is missing: the table owner role proves the filters of the queries");
// The table owner has no row level security: a query that forgets `org_id` shows another organization here.
const ownerDb = createDb(ownerUrl);
const worlds: LoopWorld[] = [];

afterEach(async () => {
  for (const world of worlds) await world.cleanup();
  worlds.length = 0;
});

afterAll(async () => {
  await Promise.all([db.destroy(), ownerDb.destroy()]);
});

async function setup() {
  const world = await loopWorld(db);
  worlds.push(world);
  const app = loopApp(db, world, (api) => api.route("/", loopRoutes({ db, now: () => FRIDAY })));
  const make = (over: Parameters<typeof commandLoop>[2] = {}, org = world.a) =>
    db.transaction().execute((trx) => commandLoop(trx, org, over));
  return { world, app, make, ctx: world.a.ctx };
}

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("T1 GET /loops", () => {
  test("a page by due date, then the cursor page; a loop of another organization is never listed", async () => {
    const { world, app, make } = await setup();
    const due = (days: number) => new Date(FRIDAY.getTime() + days * DAY_MS);
    const l3 = await make({ due_at: due(5) });
    const l1 = await make({ due_at: due(3) });
    const l2 = await make({ due_at: due(4) });
    await make({ due_at: due(1) }, world.b);
    await make({ kind: "promised", due_at: due(1) });

    const first = await call(app, "owner", "GET", "/loops?kind=waiting&limit=2");
    expect(first.status).toBe(200);
    const page = loopListSchema.parse(first.body);
    expect(page.items.map((item) => item.id)).toEqual([l1.id, l2.id]);
    expect(page.next).not.toBeNull();

    const second = await call(app, "member", "GET", `/loops?kind=waiting&limit=2&before=${page.next}`);
    const rest = loopListSchema.parse(second.body);
    expect(rest.items.map((item) => item.id)).toEqual([l3.id]);
    expect(rest.next).toBeNull();
  });

  test("the item holds the reason code, the later count and the texts of the row", async () => {
    const { app, make } = await setup();
    const waiting = await make({ later_count: 1, auto_reply_at: FRIDAY, follow_ups_sent: 1 });
    const done = await make({
      status: "closed",
      close_reason: "replied_subject",
      closed_at: FRIDAY,
      auto_reply_at: FRIDAY,
    });
    const delegated = await make({ kind: "delegated" });
    const promised = await make({ kind: "promised" });
    const cleared = await make({
      status: "closed",
      close_reason: "done",
      closed_at: FRIDAY,
      text: null,
      subject: null,
    });
    const byId = async (kind: string, filter: string, id: string) => {
      const res = await call(app, "owner", "GET", `/loops?kind=${kind}&filter=${filter}`);
      return loopListSchema.parse(res.body).items.find((item) => item.id === id);
    };
    expect(await byId("waiting", "open", waiting.id)).toMatchObject({
      reason: "asked_no_answer",
      laterLeft: 2,
      followUpsSent: 1,
      autoReplyOnly: true,
      matchedBySubject: false,
      counterpart: ANNA,
      subject: "Offer Q1",
      delegate: null,
      followUpWaiting: false,
      sendId: null,
      dueSource: "default",
      usualReplyDays: null,
    });
    expect(await byId("waiting", "closed", done.id)).toMatchObject({
      matchedBySubject: true,
      autoReplyOnly: false,
      closeReason: "replied_subject",
    });
    expect(await byId("waiting", "closed", cleared.id)).toMatchObject({ text: null, subject: null });
    const d = await byId("delegated", "open", delegated.id);
    expect(d).toMatchObject({ reason: "forwarded_to_delegate" });
    expect(d?.delegate).toMatchObject({ name: "Anna" });
    expect(await byId("promised", "open", promised.id)).toMatchObject({ reason: "promised" });
  });

  test("a loop whose due date comes from the contact shows its usual reply days; any other source shows null", async () => {
    const { app, make } = await setup();
    const contact = await make({ due_source: "contact", usual_reply_days: 2 });
    const plain = await make({ due_source: "default" });
    const list = loopListSchema.parse((await call(app, "owner", "GET", "/loops?kind=waiting")).body);
    const usual = (id: string) => list.items.find((item) => item.id === id);
    expect(usual(contact.id)).toMatchObject({ dueSource: "contact", usualReplyDays: 2 });
    expect(usual(plain.id)).toMatchObject({ dueSource: "default", usualReplyDays: null });
  });

  test("filter due: due by the end of the local day (inclusive); open and closed are split", async () => {
    const { app, make } = await setup();
    // The end of Friday 2026-11-20 in Warsaw is 2026-11-20T23:00:00Z.
    const atEnd = await make({ due_at: new Date("2026-11-20T23:00:00.000Z") });
    await make({ due_at: new Date("2026-11-20T23:00:00.001Z") });
    const overdue = await make({ due_at: new Date("2026-11-10T10:00:00Z") });
    const closed = await make({ status: "closed", close_reason: "done", closed_at: FRIDAY, due_at: FRIDAY });
    const ids = async (filter: string) =>
      loopListSchema
        .parse((await call(app, "owner", "GET", `/loops?kind=waiting&filter=${filter}`)).body)
        .items.map((item) => item.id);
    expect(await ids("due")).toEqual([overdue.id, atEnd.id]);
    expect(await ids("closed")).toEqual([closed.id]);
    expect((await ids("open")).length).toBe(3);
  });

  test("a waiting follow-up shows its send id", async () => {
    const { app, make } = await setup();
    const loop = await make();
    const planned = await call(app, "owner", "POST", `/loops/${loop.id}/follow-up`, {});
    const list = loopListSchema.parse((await call(app, "member", "GET", "/loops?kind=waiting")).body);
    expect(list.items[0]).toMatchObject({ followUpWaiting: true, sendId: planned.body.sendId });
  });

  test("a rejected follow-up does not wait: followUpWaiting is false and the send id is null", async () => {
    const { app, make } = await setup();
    const loop = await make();
    const planned = await call(app, "owner", "POST", `/loops/${loop.id}/follow-up`, {});
    await db
      .updateTable("actions")
      .set({ status: "rejected" })
      .where("id", "=", planned.body.sendId as string)
      .execute();
    const list = loopListSchema.parse((await call(app, "member", "GET", "/loops?kind=waiting")).body);
    expect(list.items[0]).toMatchObject({ followUpWaiting: false, sendId: null });
  });

  test("401 without a session; 400 for a missing kind, a bad filter, a bad limit and a bad cursor", async () => {
    const { app } = await setup();
    expect((await app.request("/api/loops?kind=waiting")).status).toBe(401);
    for (const query of [
      "",
      "?kind=other",
      "?kind=waiting&filter=all",
      "?kind=waiting&limit=0",
      "?kind=waiting&limit=101",
      "?kind=waiting&before=not-a-cursor!",
      "?kind=waiting&before=aGVsbG8",
    ]) {
      const res = await call(app, "owner", "GET", `/loops${query}`);
      expect([query, res.status]).toEqual([query, 400]);
      expect(res.body.error).toBe("validation");
    }
  });
});

describe("tenancy without row level security", () => {
  test("on the table owner connection the list and every command still see the own organization only", async () => {
    const { world, make } = await setup();
    const ownerApp = loopApp(ownerDb, world, (api) => api.route("/", loopRoutes({ db: ownerDb, now: () => FRIDAY })));
    const mine = await make({}, world.b);
    const theirs = await make({});
    const list = loopListSchema.parse((await call(ownerApp, "other", "GET", "/loops?kind=waiting")).body);
    expect(list.items.map((item) => item.id)).toEqual([mine.id]);
    for (const name of ["follow-up", "later", "done", "drop", "reopen", "untrack"]) {
      const res = await call(ownerApp, "other", "POST", `/loops/${theirs.id}/${name}`, {});
      expect([name, res.status]).toEqual([name, 404]);
    }
    expect((await loopOf(db, theirs.id)).status).toBe("open");
    expect(await actionsOfLoop(db, theirs.id)).toEqual([]);
  });
});

describe("T2 the flag off", () => {
  test("every route is a 404 not_found, for every role, also with a bad id and a bad body", async () => {
    const { app, make, ctx } = await setup();
    const loop = await make();
    await setOrgFeature(db, ctx, { flag: "open_loops", enabled: false, actor: "cli", now: FRIDAY });
    const attempts: [string, "GET" | "POST", string, unknown?][] = [
      ["owner", "GET", "/loops?kind=waiting"],
      ["member", "GET", "/loops"],
      ...["follow-up", "later", "done", "drop", "reopen", "untrack"].flatMap(
        (name): [string, "POST", string, unknown?][] => [
          ["owner", "POST", `/loops/${loop.id}/${name}`, {}],
          ["member", "POST", `/loops/${loop.id}/${name}`, {}],
          ["owner", "POST", `/loops/not-an-id/${name}`, { bogus: 1 }],
        ]
      ),
    ];
    for (const [who, method, path, body] of attempts) {
      const res = await call(app, who, method, path, body);
      expect([path, who, res.status, res.body.error]).toEqual([path, who, 404, "not_found"]);
    }
    expect((await loopOf(db, loop.id)).status).toBe("open");
  });
});

describe("T3 and T4 the follow-up", () => {
  test("the owner gets planned and a send id; again: 409 waiting; no mail goes out before the tap", async () => {
    const { app, make, ctx } = await setup();
    const loop = await make();
    const first = await call(app, "owner", "POST", `/loops/${loop.id}/follow-up`, {});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: "planned", sendId: expect.any(String) });
    const rows = await actionsOfLoop(db, loop.id);
    expect(rows.map((row) => [row.type, row.status])).toEqual([
      ["create_draft", "ready"],
      ["send", "awaiting_approval"],
    ]);
    expect(rows.find((row) => row.type === "send")?.id).toBe(first.body.sendId as string);
    const again = await call(app, "owner", "POST", `/loops/${loop.id}/follow-up`, {});
    expect([again.status, again.body]).toEqual([409, { error: "waiting" }]);
    expect((await actionsOfLoop(db, loop.id)).length).toBe(2);
    // The command wrote its audit rows with `via` web and the user as actor.
    const planned = await auditOf(db, ctx.orgId, "action.planned");
    expect(planned.map((row) => row.data)).toEqual(
      expect.arrayContaining([expect.objectContaining({ loop_id: loop.id, via: "web" })])
    );
  });

  test("in shadow mode the answer is would_draft (200) and nothing is planned", async () => {
    const { world, app, make } = await setup();
    await db
      .updateTable("mailbox_settings")
      .set({ mode: "shadow" })
      .where("mailbox_id", "=", world.a.mailboxId)
      .execute();
    const loop = await make();
    const res = await call(app, "owner", "POST", `/loops/${loop.id}/follow-up`, {});
    expect([res.status, res.body]).toEqual([200, { status: "would_draft" }]);
    expect(await actionsOfLoop(db, loop.id)).toEqual([]);
  });

  test("a promised loop has no follow-up: 409 not_allowed; an unknown id: 404", async () => {
    const { app, make } = await setup();
    const promised = await make({ kind: "promised" });
    const res = await call(app, "owner", "POST", `/loops/${promised.id}/follow-up`, {});
    expect([res.status, res.body]).toEqual([409, { error: "not_allowed" }]);
    expect((await call(app, "owner", "POST", `/loops/${UNKNOWN}/follow-up`, {})).status).toBe(404);
  });

  test("a member gets 403 owner_only before any query, also for an unknown id; nothing is planned", async () => {
    const { app, make } = await setup();
    const loop = await make();
    for (const id of [loop.id, UNKNOWN]) {
      const res = await call(app, "member", "POST", `/loops/${id}/follow-up`, {});
      expect([res.status, res.body]).toEqual([403, { error: "owner_only" }]);
    }
    expect(await actionsOfLoop(db, loop.id)).toEqual([]);
  });
});

describe("T5 the other commands", () => {
  test("Later as a member: three times 200 with the new due date, the fourth 409 limit_reached", async () => {
    const { app, make } = await setup();
    const loop = await make();
    const due = ["2026-11-26T16:00:00.000Z", "2026-12-01T16:00:00.000Z", "2026-12-04T16:00:00.000Z"];
    for (const expected of due) {
      const res = await call(app, "member", "POST", `/loops/${loop.id}/later`, {});
      expect([res.status, res.body]).toEqual([200, { status: "ok", dueAt: expected }]);
    }
    const fourth = await call(app, "member", "POST", `/loops/${loop.id}/later`, {});
    expect([fourth.status, fourth.body]).toEqual([409, { error: "limit_reached" }]);
    const promised = await make({ kind: "promised" });
    expect((await call(app, "member", "POST", `/loops/${promised.id}/later`, {})).body).toEqual({
      error: "not_allowed",
    });
  });

  test("Done: a member closes; again 409 already. Drop, Reopen, Untrack: the owner; a member gets 403", async () => {
    const { app, make } = await setup();
    const loop = await make();
    expect((await call(app, "member", "POST", `/loops/${loop.id}/done`, {})).body).toEqual({ status: "ok" });
    expect((await loopOf(db, loop.id)).close_reason).toBe("done");
    expect((await call(app, "member", "POST", `/loops/${loop.id}/done`, {})).body).toEqual({ error: "already" });
    for (const name of ["drop", "reopen", "untrack"]) {
      const res = await call(app, "member", "POST", `/loops/${loop.id}/${name}`, {});
      expect([name, res.status, res.body]).toEqual([name, 403, { error: "owner_only" }]);
    }
    expect((await call(app, "owner", "POST", `/loops/${loop.id}/reopen`, {})).body).toEqual({ status: "ok" });
    expect((await loopOf(db, loop.id)).status).toBe("open");
    expect((await call(app, "owner", "POST", `/loops/${loop.id}/drop`, {})).body).toEqual({ status: "ok" });
    expect((await loopOf(db, loop.id)).close_reason).toBe("dropped");
    expect((await call(app, "owner", "POST", `/loops/${loop.id}/drop`, {})).body).toEqual({ error: "already" });
    expect((await call(app, "owner", "POST", `/loops/${loop.id}/untrack`, {})).body).toEqual({ error: "not_allowed" });
    const delegated = await make({ kind: "delegated" });
    expect((await call(app, "owner", "POST", `/loops/${delegated.id}/untrack`, {})).body).toEqual({ status: "ok" });
    expect((await loopOf(db, delegated.id)).close_reason).toBe("untracked");
  });

  test("a loop of another organization is a 404 for every command; the row stays", async () => {
    const { world, app, make } = await setup();
    const foreign = await make({}, world.b);
    for (const name of ["follow-up", "later", "done", "drop", "reopen", "untrack"]) {
      const res = await call(app, "owner", "POST", `/loops/${foreign.id}/${name}`, {});
      expect([name, res.status, res.body]).toEqual([name, 404, { error: "not_found" }]);
    }
    expect((await loopOf(db, foreign.id)).status).toBe("open");
  });

  test("a body field, a non-UUID id and no session are refused: 400, 400, 401", async () => {
    const { app, make } = await setup();
    const loop = await make();
    expect((await call(app, "owner", "POST", `/loops/${loop.id}/done`, { extra: 1 })).status).toBe(400);
    expect((await call(app, "owner", "POST", "/loops/not-an-id/done", {})).status).toBe(400);
    const noCookie = {
      method: "POST",
      headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
      body: "{}",
    };
    expect((await app.request(`/api/loops/${loop.id}/done`, noCookie)).status).toBe(401);
  });

  test("a suspended organization reads but does not write: 403 org_suspended", async () => {
    const { app, make, ctx } = await setup();
    const loop = await make();
    await db.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", ctx.orgId).execute();
    expect((await call(app, "owner", "GET", "/loops?kind=waiting")).status).toBe(200);
    const res = await call(app, "owner", "POST", `/loops/${loop.id}/done`, {});
    expect([res.status, res.body]).toEqual([403, { error: "org_suspended" }]);
    expect((await loopOf(db, loop.id)).status).toBe("open");
  });
});

describe("T6 POST /emails/:id/delegate", () => {
  const body = (world: LoopWorld, over: object = {}) => ({ delegateId: world.delegateId, ...over });

  test("the owner gets the ids of the draft pair and the delegation; again: 409 exists; the send waits for a tap", async () => {
    const { world, app } = await setup();
    const first = await call(app, "owner", "POST", `/emails/${world.emailId}/delegate`, body(world));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ sendId: expect.any(String), delegationId: expect.any(String) });
    const send = await db
      .selectFrom("actions")
      .selectAll()
      .where("id", "=", first.body.sendId as string)
      .executeTakeFirst();
    expect(send).toMatchObject({ type: "send", status: "awaiting_approval" });
    const again = await call(app, "owner", "POST", `/emails/${world.emailId}/delegate`, body(world));
    expect([again.status, again.body]).toEqual([409, { error: "exists" }]);
  });

  test("a member gets 403 owner_only; an inactive delegate 409 delegate_inactive; an unknown mail 404; a bad body 400", async () => {
    const { world, app } = await setup();
    const member = await call(app, "member", "POST", `/emails/${world.emailId}/delegate`, body(world));
    expect([member.status, member.body]).toEqual([403, { error: "owner_only" }]);
    // The role comes before any query: a member gets 403 also for an unknown mail.
    const unknown = await call(app, "member", "POST", `/emails/${UNKNOWN}/delegate`, body(world));
    expect([unknown.status, unknown.body]).toEqual([403, { error: "owner_only" }]);
    await db.updateTable("delegates").set({ active: false }).where("id", "=", world.delegateId).execute();
    const inactive = await call(app, "owner", "POST", `/emails/${world.emailId}/delegate`, body(world));
    expect([inactive.status, inactive.body]).toEqual([409, { error: "delegate_inactive" }]);
    expect((await call(app, "owner", "POST", `/emails/${UNKNOWN}/delegate`, body(world))).status).toBe(404);
    expect((await call(app, "owner", "POST", `/emails/${world.emailId}/delegate`, { delegateId: "x" })).status).toBe(
      400
    );
    expect((await call(app, "owner", "POST", `/emails/${world.emailId}/delegate`, {})).status).toBe(400);
  });

  test("another organization's owner cannot delegate this mail: 404", async () => {
    const { world, app } = await setup();
    const res = await call(app, "other", "POST", `/emails/${world.emailId}/delegate`, body(world));
    expect(res.status).toBe(404);
    expect(await db.selectFrom("delegations").selectAll().where("org_id", "=", world.a.ctx.orgId).execute()).toEqual(
      []
    );
  });

  test("the flag delegate_button decides: off gives 404 for every role; open_loops off changes nothing", async () => {
    const { world, app, ctx } = await setup();
    await setOrgFeature(db, ctx, { flag: "delegate_button", enabled: false, actor: "cli", now: FRIDAY });
    for (const who of ["owner", "member"]) {
      const res = await call(app, who, "POST", `/emails/${world.emailId}/delegate`, body(world));
      expect([who, res.status, res.body]).toEqual([who, 404, { error: "not_found" }]);
    }
    await setOrgFeature(db, ctx, { flag: "delegate_button", enabled: true, actor: "cli", now: FRIDAY });
    await setOrgFeature(db, ctx, { flag: "open_loops", enabled: false, actor: "cli", now: FRIDAY });
    expect((await call(app, "owner", "POST", `/emails/${world.emailId}/delegate`, body(world))).status).toBe(200);
  });
});
