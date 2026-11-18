import { delegateListSchema, delegateSchema, DELEGATE_LIST_MAX } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { delegateRoutes, updateDelegate } from "../../src/modules/delegation";
import { lockDelegate } from "../../src/modules/delegation/repo";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature } from "../../src/modules/tenancy";

import { insertDelegate, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-20T12:00:00Z");

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

// O1 (owner, assistant "member") and O2 (other owner), the delegate routes, the flag on for both unless `flag: false`.
async function setup(opts: { flag?: boolean } = {}) {
  const org = await webOrg(db);
  orgs.push(org);
  const ctx = { orgId: org.orgId };
  if (opts.flag !== false) {
    for (const orgId of [org.orgId, org.otherOrgId]) {
      await setOrgFeature(db, { orgId }, { flag: "delegation_pages", enabled: true, actor: "cli", now: NOW });
    }
  }
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
    routers: (api) => {
      api.route("/", delegateRoutes({ db, now: () => NOW }));
    },
  });
  return { org, ctx, app };
}

type Seed = Awaited<ReturnType<typeof setup>>;

const send = (s: Seed, who: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown) =>
  s.app.request(`/api/delegates${path}`, as(who, { method, ...(body === undefined ? {} : { body }) }));

async function addMailbox(orgId: string, address: string): Promise<void> {
  const id = crypto.randomUUID();
  await insertMailbox(
    db,
    { orgId },
    {
      id,
      address,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: {},
    }
  );
  await insertInboxFolder(db, { orgId }, id);
}

const auditOf = (orgId: string, event: string) =>
  db.selectFrom("audit_log").selectAll().where("org_id", "=", orgId).where("event", "=", event).orderBy("id").execute();

describe("the delegate routes", () => {
  test("T7. 401 without a session; flag off: 404 not_found on all three, for the owner and for a member, also with a bad id", async () => {
    const s = await setup({ flag: false });
    expect((await s.app.request("/api/delegates")).status).toBe(401);
    for (const who of ["owner", "member"]) {
      for (const [method, path, body] of [
        ["GET", "", undefined],
        ["POST", "", { name: "Piotr Lis", email: "piotr@example.com", tags: [] }],
        ["PATCH", `/${crypto.randomUUID()}`, { active: false }],
        ["PATCH", "/not-an-id", { active: false }],
        ["PATCH", "/not-an-id", {}],
      ] as const) {
        const res = await send(s, who, method, path, body);
        expect([who, method, path, res.status, await res.json()]).toEqual([
          who,
          method,
          path,
          404,
          { error: "not_found" },
        ]);
      }
    }
    expect(await auditOf(s.org.orgId, "delegate.added")).toEqual([]);
  });

  test("T8. a member reads the list and gets 403 owner_only on POST and PATCH; nothing changes", async () => {
    const s = await setup();
    const id = await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: "Anna" }));
    const list = await send(s, "member", "GET", "");
    expect(list.status).toBe(200);
    expect(delegateListSchema.parse(await list.json()).items.map((d) => d.id)).toEqual([id]);
    for (const [method, path, body] of [
      ["POST", "", { name: "Piotr", email: "piotr@example.com", tags: [] }],
      ["PATCH", `/${id}`, { active: false }],
    ] as const) {
      const res = await send(s, "member", method, path, body);
      expect([res.status, await res.json()]).toEqual([403, { error: "owner_only" }]);
    }
    expect((await send(s, "owner", "GET", "")).status).toBe(200);
    expect(await auditOf(s.org.orgId, "delegate.added")).toEqual([]);
    expect(await auditOf(s.org.orgId, "delegate.changed")).toEqual([]);
  });

  test("T9. POST adds a delegate with a lower case address (201); the same address again is 409 exists; audit row with the user and via", async () => {
    const s = await setup();
    const res = await send(s, "owner", "POST", "", {
      name: " Piotr Lis ",
      email: "Piotr@Example.com",
      tags: ["IT", " it"],
    });
    expect(res.status).toBe(201);
    const delegate = delegateSchema.parse(await res.json());
    expect(delegate).toMatchObject({ name: "Piotr Lis", email: "piotr@example.com", tags: ["it"], active: true });
    const again = await send(s, "owner", "POST", "", { name: "Piotr", email: "piotr@example.com", tags: [] });
    expect([again.status, await again.json()]).toEqual([409, { error: "exists" }]);
    const audit = await auditOf(s.org.orgId, "delegate.added");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: s.org.ownerId });
    expect(audit[0]?.data).toEqual({ delegate_id: delegate.id, via: "web" });
    // The same address in the other organization is no conflict.
    const theirs = await send(s, "other", "POST", "", { name: "Piotr", email: "piotr@example.com", tags: [] });
    expect(theirs.status).toBe(201);
  });

  test("T10. POST with the address of a mailbox of the organization is 400 mailbox_address; a mailbox of O2 is no block", async () => {
    const s = await setup();
    await addMailbox(s.org.orgId, "boss@x.test");
    await addMailbox(s.org.otherOrgId, "theirs@x.test");
    const res = await send(s, "owner", "POST", "", { name: "Boss", email: "BOSS@x.test", tags: [] });
    expect([res.status, await res.json()]).toEqual([400, { error: "mailbox_address" }]);
    expect((await send(s, "owner", "POST", "", { name: "Theirs", email: "theirs@x.test", tags: [] })).status).toBe(201);
    expect(await auditOf(s.org.orgId, "delegate.added")).toHaveLength(1);
  });

  test("POST: a name, an address or tags that the service refuses are 400 validation with the field; a bad body is 400 validation", async () => {
    const s = await setup();
    const ok = { name: "Piotr", email: "piotr@example.com", tags: [] as string[] };
    for (const [body, path] of [
      [{ ...ok, name: "x".repeat(101) }, "name"],
      [{ ...ok, name: "   " }, "name"],
      [{ ...ok, email: "not an address" }, "email"],
      [{ ...ok, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, "tags"],
      [{ ...ok, tags: ["x".repeat(31)] }, "tags"],
    ] as const) {
      const res = await send(s, "owner", "POST", "", body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; details: { path: string }[] };
      expect(json.error).toBe("validation");
      expect(json.details.map((d) => d.path)).toEqual([path]);
    }
    for (const body of [{}, { ...ok, extra: 1 }, { ...ok, tags: "it" }, { name: "A", email: "a@b.test" }]) {
      const res = await send(s, "owner", "POST", "", body);
      expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([400, "validation"]);
    }
    expect(await auditOf(s.org.orgId, "delegate.added")).toEqual([]);
  });

  test("T11. PATCH with {} is 400 validation; { active: false } is 200 with active false; name and tags change; an address is refused", async () => {
    const s = await setup();
    const id = await db
      .transaction()
      .execute((trx) => insertDelegate(trx, s.ctx, { name: "Anna", email: "anna@example.com", tags: ["finance"] }));
    const empty = await send(s, "owner", "PATCH", `/${id}`, {});
    expect([empty.status, ((await empty.json()) as { error: string }).error]).toEqual([400, "validation"]);
    const off = await send(s, "owner", "PATCH", `/${id}`, { active: false });
    expect(off.status).toBe(200);
    expect(delegateSchema.parse(await off.json())).toMatchObject({ id, active: false, name: "Anna" });
    const edit = await send(s, "owner", "PATCH", `/${id}`, { name: "Anna Nowak-Lis", tags: ["finance", "Budget "] });
    expect(delegateSchema.parse(await edit.json())).toMatchObject({
      name: "Anna Nowak-Lis",
      tags: ["finance", "budget"],
      active: false,
      email: "anna@example.com",
    });
    const same = await send(s, "owner", "PATCH", `/${id}`, { name: "Anna Nowak-Lis" });
    expect(same.status).toBe(200);
    // The address never changes.
    const mail = await send(s, "owner", "PATCH", `/${id}`, { active: true, email: "other@example.com" });
    expect([mail.status, ((await mail.json()) as { error: string }).error]).toEqual([400, "validation"]);
    const kept = await db
      .selectFrom("delegates")
      .select(["email", "active"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(kept).toEqual({ email: "anna@example.com", active: false });
    const bad = await send(s, "owner", "PATCH", `/${id}`, { name: "x".repeat(101) });
    const badJson = (await bad.json()) as { error: string; details: { path: string }[] };
    expect([bad.status, badJson.error, badJson.details.map((d) => d.path)]).toEqual([400, "validation", ["name"]]);
    const audit = await auditOf(s.org.orgId, "delegate.changed");
    expect(audit.map((row) => row.data)).toEqual([
      { delegate_id: id, fields: "active", active: false, via: "web" },
      { delegate_id: id, fields: "name,tags", via: "web" },
    ]);
    expect(audit[0]).toMatchObject({ actor: s.org.ownerId });
    expect((await send(s, "owner", "PATCH", "/not-an-id", { active: true })).status).toBe(400);
  });

  test("T12. a delegate of O2 is 404 on PATCH for O1 and stays unchanged; the list of O1 holds none of it", async () => {
    const s = await setup();
    const theirs = await db
      .transaction()
      .execute((trx) => insertDelegate(trx, { orgId: s.org.otherOrgId }, { name: "Theirs", email: "t@example.com" }));
    const mine = await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: "Mine" }));
    const res = await send(s, "owner", "PATCH", `/${theirs}`, { name: "Taken", active: false });
    expect([res.status, await res.json()]).toEqual([404, { error: "not_found" }]);
    const row = await db.selectFrom("delegates").selectAll().where("id", "=", theirs).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ name: "Theirs", active: true });
    expect(await auditOf(s.org.otherOrgId, "delegate.changed")).toEqual([]);
    const list = delegateListSchema.parse(await (await send(s, "owner", "GET", "")).json());
    expect(list.items.map((d) => d.id)).toEqual([mine]);
    const theirList = delegateListSchema.parse(await (await send(s, "other", "GET", "")).json());
    expect(theirList.items.map((d) => d.id)).toEqual([theirs]);
  });

  test("GET lists active delegates first, then by name, with the shape of the schema", async () => {
    const s = await setup();
    await db.transaction().execute(async (trx) => {
      await insertDelegate(trx, s.ctx, { name: "Zed", email: "zed@example.com", tags: ["a"] });
      await insertDelegate(trx, s.ctx, { name: "Ann", email: "ann@example.com", active: false });
      await insertDelegate(trx, s.ctx, { name: "Bea", email: "bea@example.com" });
    });
    const res = await send(s, "owner", "GET", "");
    const json = (await res.json()) as { items: Record<string, unknown>[] };
    const list = delegateListSchema.parse(json);
    expect(list.items.map((d) => [d.name, d.active])).toEqual([
      ["Bea", true],
      ["Zed", true],
      ["Ann", false],
    ]);
    expect(Object.keys(json.items[0] ?? {}).sort()).toEqual(["active", "createdAt", "email", "id", "name", "tags"]);
    expect(json.items.find((d) => d.name === "Zed")?.tags).toEqual(["a"]);
  });

  test("GET holds at most 200 delegates", async () => {
    const s = await setup();
    await db
      .insertInto("delegates")
      .values(
        Array.from({ length: DELEGATE_LIST_MAX + 5 }, (_, i) => ({
          org_id: s.org.orgId,
          name: `D${String(i).padStart(3, "0")}`,
          email: `d${i}@example.com`,
          competence_tags: [],
        }))
      )
      .execute();
    const list = delegateListSchema.parse(await (await send(s, "owner", "GET", "")).json());
    expect(list.items).toHaveLength(DELEGATE_LIST_MAX);
  });

  test("a disabled delegate stays in the list as inactive", async () => {
    const s = await setup();
    const id = await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: "Anna" }));
    await send(s, "owner", "PATCH", `/${id}`, { active: false });
    const list = delegateListSchema.parse(await (await send(s, "owner", "GET", "")).json());
    expect(list.items).toMatchObject([{ id, active: false }]);
  });
});

describe("the row lock of a delegate change", () => {
  test("two simultaneous PATCH active:false on one delegate give one audit row per loop", async () => {
    const s = await setup();
    for (let loop = 0; loop < 25; loop += 1) {
      const id = await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: `Race${loop}` }));
      const answers = await Promise.all([
        send(s, "owner", "PATCH", `/${id}`, { active: false }),
        send(s, "owner", "PATCH", `/${id}`, { active: false }),
      ]);
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const rows = (await auditOf(s.org.orgId, "delegate.changed")).filter(
        (row) => (row.data as { delegate_id?: string } | null)?.delegate_id === id
      );
      expect(rows).toHaveLength(1);
    }
  });

  test("a held row lock blocks updateDelegate until the holder commits", async () => {
    const s = await setup();
    const id = await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: "Held" }));
    let settled = false;
    let pending: ReturnType<typeof updateDelegate> | undefined;
    await db.transaction().execute(async (trx) => {
      expect(await lockDelegate(trx, s.ctx, id)).toMatchObject({ id });
      pending = updateDelegate(db, s.ctx, { id, active: false, actor: "user-1", via: "web", now: NOW });
      void pending.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);
    });
    expect(await pending).toEqual({ kind: "changed" });
    expect(settled).toBe(true);
  });
});
