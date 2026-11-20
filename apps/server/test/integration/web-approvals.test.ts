import { randomUUID } from "node:crypto";

import {
  APPROVAL_QUOTE_MAX,
  approvalDetailSchema,
  approvalListSchema,
  meSchema,
  type ApprovalDetail,
  MINUTE_MS,
  HOUR_MS,
} from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { editApproval, getSend, noApprovalHooks, noDelegationHooks, type SendScope } from "../../src/modules/actions";
import { approvalRoutes } from "../../src/modules/channels";
import { approvalViewFor } from "../../src/modules/channels/notices/approval";
import { insertDefaultSettings, updateMailboxSettings } from "../../src/modules/config";
import { delegationHooks } from "../../src/modules/delegation";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { setOrgFeature, tenancyRoutes } from "../../src/modules/tenancy";
import { approvalsWaiting, countMailboxes, onboardingDeps } from "../../src/web";

import { insertDelegate, insertDraftAndSend, testCapabilities } from "./fixtures";
import { testDb } from "./helpers";
import { as, noBackupCodes, TEST_ORIGIN, webOrg, webTestApp, type WebOrg } from "./web-helpers";

const db = testDb();
const NOW = new Date("2026-11-20T12:00:00Z");
const at = (offsetMin: number) => new Date(Date.UTC(2026, 10, 20, 8, offsetMin));

const orgs: WebOrg[] = [];

afterEach(async () => {
  for (const org of orgs) await org.cleanup();
  orgs.length = 0;
});

afterAll(async () => {
  await db.destroy();
});

async function addMailbox(orgId: string, uidplus = true): Promise<string> {
  const ctx = { orgId };
  const id = randomUUID();
  await insertMailbox(db, ctx, {
    id,
    address: `approvals-${id}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: { ...testCapabilities, uidplus },
    folderMap: { drafts: "Drafts" },
  });
  await insertInboxFolder(db, ctx, id);
  return id;
}

async function setup(opts: { flag?: boolean; sendScope?: SendScope } = {}) {
  const org = await webOrg(db);
  orgs.push(org);
  const ctx = { orgId: org.orgId };
  const mailboxId = await addMailbox(org.orgId);
  const theirMailboxId = await addMailbox(org.otherOrgId);
  if (opts.flag !== false) {
    await setOrgFeature(db, ctx, { flag: "approvals_page", enabled: true, actor: "cli", now: NOW });
    await setOrgFeature(
      db,
      { orgId: org.otherOrgId },
      { flag: "approvals_page", enabled: true, actor: "cli", now: NOW }
    );
  }
  const sendScope = opts.sendScope ?? ({ kind: "off" } as const);
  const app = webTestApp({
    db,
    sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
    routers: (api) => {
      api.route(
        "/",
        approvalRoutes({ db, now: () => NOW, sendScope, hooks: noDelegationHooks, uidplus: async () => true })
      );
      api.route(
        "/",
        tenancyRoutes({
          db,
          now: () => NOW,
          scopes: {
            triage: { kind: "off", reason: "env_off" },
            actions: { kind: "off", reason: "env_off" },
            send: { kind: "off", reason: "env_off" },
          },
          countMailboxes: countMailboxes(db),
          approvalsWaiting: approvalsWaiting(db),
          operatorContact: null,
          sessions: async () => [],
          backupCodesLeft: noBackupCodes,
          ...onboardingDeps(db, null),
        })
      );
    },
  });
  return { org, ctx, mailboxId, theirMailboxId, app };
}

type Seed = Awaited<ReturnType<typeof setup>>;
type SendOpts = Parameters<typeof insertDraftAndSend>[3];

async function addSend(orgId: string, mailboxId: string, opts: SendOpts = {}): Promise<string> {
  const { sendId } = await db
    .transaction()
    .execute((trx) => insertDraftAndSend(trx, { orgId }, mailboxId, { createdAt: NOW, ...opts }));
  return sendId;
}

async function approvedBy(org: WebOrg, when = NOW) {
  return { userId: org.ownerId, at: when };
}

async function list(s: Seed, who = "owner") {
  const res = await s.app.request("/api/approvals", as(who));
  return { res, body: res.status === 200 ? approvalListSchema.parse(await res.json()) : await res.json() };
}

async function detail(s: Seed, id: string, who = "owner"): Promise<ApprovalDetail> {
  const res = await s.app.request(`/api/approvals/${id}`, as(who));
  expect(res.status).toBe(200);
  return approvalDetailSchema.parse(await res.json());
}

// Test data: A waiting with an applied draft, B waiting with a ready draft, C approved and held by SEND_SCOPE, D applied.
async function t2Data(s: Seed) {
  const a = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(1), draftStatus: "applied" });
  const b = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(2), draftStatus: "ready" });
  const c = await addSend(s.org.orgId, s.mailboxId, {
    createdAt: at(3),
    sendStatus: "approved",
    approved: await approvedBy(s.org),
  });
  const d = await addSend(s.org.orgId, s.mailboxId, {
    createdAt: at(4),
    sendStatus: "applied",
    approved: await approvedBy(s.org),
  });
  return { a, b, c, d };
}

describe("GET /api/approvals and GET /api/approvals/:id", () => {
  test("T1. 401 without a session; 404 not_found for both routes while the flag is off, also with a bad id", async () => {
    const s = await setup({ flag: false });
    const id = await addSend(s.org.orgId, s.mailboxId);
    expect((await s.app.request("/api/approvals", { headers: { origin: TEST_ORIGIN } })).status).toBe(401);
    for (const url of ["/api/approvals", `/api/approvals/${id}`, "/api/approvals/nope"]) {
      const res = await s.app.request(url, as("owner"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  test("T2. the list holds the waiting and the held sends, newest first; a closed send is absent", async () => {
    const s = await setup();
    const { a, b, c, d } = await t2Data(s);
    const { res, body } = await list(s);
    expect(res.status).toBe(200);
    const items = approvalListSchema.parse(body).items;
    expect(items.map((item) => item.id)).toEqual([c, b, a]);
    expect(items.map((item) => item.id)).not.toContain(d);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(a)).toMatchObject({
      state: "waiting",
      draftReady: true,
      heldBy: null,
      kind: "delegation",
      version: 1,
    });
    expect(byId.get(b)).toMatchObject({ state: "waiting", draftReady: false, heldBy: null });
    expect(byId.get(c)).toMatchObject({ state: "held", heldBy: "scope", delegationId: null, setId: null });
    expect(byId.get(a)?.mailboxAddress).toStartWith("approvals-");
    expect(byId.get(a)?.view.recipient.address).toContain("@");
  });

  test("T2b. a held send shows the state of its mailbox first: paused before scope", async () => {
    const s = await setup();
    const c = await addSend(s.org.orgId, s.mailboxId, { sendStatus: "approved", approved: await approvedBy(s.org) });
    await db.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", s.mailboxId).execute();
    expect((await list(s)).body.items[0]).toMatchObject({ id: c, state: "held", heldBy: "paused" });
    // A send that a run holds is in flight: not listed. A stale lock does not count.
    await db
      .updateTable("actions")
      .set({ locked_at: new Date(NOW.getTime() - HOUR_MS) })
      .where("id", "=", c)
      .execute();
    expect((await list(s)).body.items).toHaveLength(1);
    await db
      .updateTable("actions")
      .set({ locked_at: new Date(NOW.getTime() - MINUTE_MS) })
      .where("id", "=", c)
      .execute();
    expect((await list(s)).body.items).toEqual([]);
  });

  test("T3. a member who is not the owner reads the same list", async () => {
    const s = await setup();
    const { a, b, c } = await t2Data(s);
    const owner = await list(s, "owner");
    const member = await list(s, "member");
    expect(member.res.status).toBe(200);
    expect(member.body).toEqual(owner.body);
    expect(member.body.items.map((item: { id: string }) => item.id)).toEqual([c, b, a]);
    const one = await s.app.request(`/api/approvals/${a}`, as("member"));
    expect(one.status).toBe(200);
  });

  test("T4. an id of the other organization is 404 on the detail and absent from the list; a bad id is 400 validation", async () => {
    const s = await setup();
    const mine = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(1) });
    const theirs = await addSend(s.org.otherOrgId, s.theirMailboxId, { createdAt: at(2) });
    const foreign = await s.app.request(`/api/approvals/${theirs}`, as("owner"));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "not_found" });
    expect((await list(s)).body.items.map((item: { id: string }) => item.id)).toEqual([mine]);
    // The other organization sees only its own send.
    expect((await list(s, "other")).body.items.map((item: { id: string }) => item.id)).toEqual([theirs]);
    expect((await s.app.request(`/api/approvals/${mine}`, as("other"))).status).toBe(404);
    const bad = await s.app.request("/api/approvals/not-a-uuid", as("owner"));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("validation");
  });

  test("T4b. the id of a create_draft row or of an unknown row is 404", async () => {
    const s = await setup();
    const { draftId } = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, s.ctx, s.mailboxId, { createdAt: NOW }));
    expect((await s.app.request(`/api/approvals/${draftId}`, as("owner"))).status).toBe(404);
    expect((await s.app.request(`/api/approvals/${randomUUID()}`, as("owner"))).status).toBe(404);
  });

  test("T5. the view of the detail is the view of the card; the quote is the whole one, the card's is cut at 1500", async () => {
    const s = await setup();
    const original = "x".repeat(5000);
    const id = await addSend(s.org.orgId, s.mailboxId, { bodyText: original, subject: "Offer", from: "boss@x.test" });
    const got = await detail(s, id);
    const send = await getSend(db, s.ctx, id);
    if (send === undefined) throw new Error("send missing");
    const card = await approvalViewFor(db, s.ctx, send);
    expect(got.view?.body).toBe(card.view.body);
    expect(got.view).toEqual(card.view);
    expect(got.view?.quote?.cut).toBe(true);
    expect(Array.from(got.view?.quote?.text ?? "").length).toBeLessThanOrEqual(1500);
    expect(got.quote).toBe(card.quote ?? "");
    expect(got.quote).toContain(`> ${original}`);
    expect(got.quote).not.toContain("[…]");
    // The page link is the card's link only: the detail has no panelUrl.
    expect(got.view?.panelUrl).toBeUndefined();
  });

  test("a mail over 8000 characters gives a quote cut at the 8000 limit, inside the schema bound", async () => {
    const s = await setup();
    const id = await addSend(s.org.orgId, s.mailboxId, { bodyText: "x".repeat(9000), from: "boss@x.test" });
    const got = await detail(s, id);
    expect(got.quote).toContain(`> ${"x".repeat(8000)} […]`);
    expect(got.quote).not.toContain("x".repeat(8001));
    expect(got.quote?.length ?? 0).toBeLessThan(APPROVAL_QUOTE_MAX);
  });

  test("T6. after a stage 08 edit of A the detail of A is superseded with currentId; the list holds the new send", async () => {
    const s = await setup();
    await db.transaction().execute(async (trx) => {
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      await updateMailboxSettings(trx, s.ctx, s.mailboxId, {
        mode: "assist",
        toolSwitches: { move: true, mark_read: true, flag: true, create_draft: true, move_unsure: false },
      });
    });
    const a = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(1) });
    const result = await editApproval(
      { db, hooks: delegationHooks({ db }), approvalHooks: noApprovalHooks, uidplus: async () => true },
      s.ctx,
      a,
      { userId: s.org.ownerId, via: "web", now: NOW, subject: "New subject", body: "New body" }
    );
    if (result.kind !== "edited") throw new Error(`edit gave ${result.kind}`);
    const old = await detail(s, a);
    expect(old).toMatchObject({ state: "superseded", currentId: result.sendId, expiresAt: null });
    const current = await detail(s, result.sendId);
    expect(current).toMatchObject({ state: "waiting", currentId: null, version: 2 });
    expect(current.view?.subject).toBe("New subject");
    expect(current.view?.body).toBe("New body");
    const items = (await list(s)).body.items;
    expect(items.map((item: { id: string }) => item.id)).toEqual([result.sendId]);
  });

  test("T7. expiresAt: waiting from notified_at, else created_at + 7 days; held from approved_at + 48 h; draftRemovable follows UIDPLUS", async () => {
    const s = await setup();
    const a = await addSend(s.org.orgId, s.mailboxId, {
      createdAt: at(1),
      notifiedAt: new Date("2026-11-20T10:00:00Z"),
    });
    const b = await addSend(s.org.orgId, s.mailboxId, { createdAt: new Date("2026-11-20T09:00:00Z") });
    const c = await addSend(s.org.orgId, s.mailboxId, {
      createdAt: at(3),
      sendStatus: "approved",
      approved: { userId: s.org.ownerId, at: new Date("2026-11-20T11:00:00Z") },
    });
    expect((await detail(s, a)).expiresAt).toBe("2026-11-22T10:00:00.000Z");
    expect((await detail(s, b)).expiresAt).toBe("2026-11-27T09:00:00.000Z");
    expect((await detail(s, c)).expiresAt).toBe("2026-11-22T11:00:00.000Z");
    const items = (await list(s)).body.items;
    expect(new Map(items.map((item: { id: string; expiresAt: string }) => [item.id, item.expiresAt]))).toEqual(
      new Map([
        [a, "2026-11-22T10:00:00.000Z"],
        [b, "2026-11-27T09:00:00.000Z"],
        [c, "2026-11-22T11:00:00.000Z"],
      ])
    );

    expect((await detail(s, a)).draftRemovable).toBe(true);
    const noUid = await addMailbox(s.org.orgId, false);
    const e = await addSend(s.org.orgId, noUid, { createdAt: at(5) });
    expect((await detail(s, e)).draftRemovable).toBe(false);
  });

  test("T8. the detail of a delegation send lists the active delegates only; a clarification has none", async () => {
    const s = await setup();
    const anna = await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: "Anna" }));
    await db.transaction().execute((trx) => insertDelegate(trx, s.ctx, { name: "Old", active: false }));
    await db.transaction().execute((trx) => insertDelegate(trx, { orgId: s.org.otherOrgId }, { name: "Foreign" }));
    const delegation = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(1) });
    const clarification = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(2), kind: "clarification" });
    const got = await detail(s, delegation);
    expect(got.delegates.map((d) => d.name)).toEqual(["Anna"]);
    expect(got.delegates[0]).toEqual({ id: anna, name: "Anna", email: expect.any(String) });
    expect((await detail(s, clarification)).delegates).toEqual([]);
    expect((await detail(s, clarification)).kind).toBe("clarification");
  });

  test("the state of a send in each status", async () => {
    const s = await setup();
    const make = (sendStatus: string, over: SendOpts = {}) =>
      addSend(s.org.orgId, s.mailboxId, { sendStatus, approved: { userId: s.org.ownerId, at: NOW }, ...over });
    const applying = await make("applying");
    const sent = await make("applied");
    const rejected = await make("rejected");
    const failed = await make("failed");
    const expired = await make("expired");
    const sendingApproved = await make("approved", { lockedAt: new Date(NOW.getTime() - MINUTE_MS) });
    const heldApproved = await make("approved", { lockedAt: new Date(NOW.getTime() - HOUR_MS) });
    const state = async (id: string) => (await detail(s, id)).state;
    expect(await state(applying)).toBe("sending");
    expect(await state(sent)).toBe("sent");
    expect(await state(rejected)).toBe("rejected");
    expect(await state(failed)).toBe("failed");
    expect(await state(expired)).toBe("expired");
    expect(await state(sendingApproved)).toBe("sending");
    expect(await state(heldApproved)).toBe("held");
    expect((await detail(s, heldApproved)).heldBy).toBe("scope");
    expect((await detail(s, sendingApproved)).heldBy).toBeNull();
    expect((await detail(s, sent)).expiresAt).toBeNull();
  });

  test("a send whose payload retention cleared is left out of the list and has a null view in the detail", async () => {
    const s = await setup();
    const kept = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(1) });
    const cleared = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(2) });
    await db
      .updateTable("actions")
      .set({ payload: JSON.stringify({}) })
      .where("id", "=", cleared)
      .execute();
    expect((await list(s)).body.items.map((item: { id: string }) => item.id)).toEqual([kept]);
    expect(await detail(s, cleared)).toMatchObject({
      state: "waiting",
      view: null,
      quote: null,
      kind: null,
      version: null,
      delegates: [],
      delegationId: null,
      setId: null,
    });
    // A cleared draft with an intact send: the view is gone too.
    const draftGone = await db
      .transaction()
      .execute((trx) => insertDraftAndSend(trx, s.ctx, s.mailboxId, { createdAt: at(3) }));
    await db
      .updateTable("actions")
      .set({ payload: JSON.stringify({}) })
      .where("id", "=", draftGone.draftId)
      .execute();
    expect(await detail(s, draftGone.sendId)).toMatchObject({ view: null, kind: "delegation", version: null });
    expect((await list(s)).body.items.map((item: { id: string }) => item.id)).toEqual([kept]);
  });

  test("the list holds at most 100 items", async () => {
    const s = await setup();
    await db.transaction().execute(async (trx) => {
      for (let i = 0; i < 102; i += 1) {
        await insertDraftAndSend(trx, s.ctx, s.mailboxId, { createdAt: new Date(NOW.getTime() - i * MINUTE_MS) });
      }
    });
    const items = (await list(s)).body.items;
    expect(items).toHaveLength(100);
    // Newest first.
    const times = items.map((item: { createdAt: string }) => item.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  test("the answer carries no key beyond the schema (no payload, no email id, no approver)", async () => {
    const s = await setup();
    const id = await addSend(s.org.orgId, s.mailboxId, { createdAt: at(1) });
    const raw = (await (await s.app.request("/api/approvals", as("owner"))).json()) as { items: object[] };
    expect(Object.keys(raw)).toEqual(["items"]);
    expect(Object.keys(raw.items[0] ?? {}).sort()).toEqual(
      [
        "createdAt",
        "delegationId",
        "draftReady",
        "expiresAt",
        "heldBy",
        "id",
        "kind",
        "mailboxAddress",
        "setId",
        "state",
        "version",
        "view",
      ].sort()
    );
    const one = (await (await s.app.request(`/api/approvals/${id}`, as("owner"))).json()) as object;
    expect(Object.keys(one).sort()).toEqual(
      [
        "createdAt",
        "currentId",
        "delegates",
        "delegationId",
        "draftReady",
        "draftRemovable",
        "expiresAt",
        "heldBy",
        "id",
        "kind",
        "mailboxAddress",
        "quote",
        "setId",
        "state",
        "version",
        "view",
      ].sort()
    );
  });
});

describe("GET /api/me approvalsWaiting (T9)", () => {
  const waiting = async (s: Seed, who: string) =>
    meSchema.parse(await (await s.app.request("/api/me", as(who))).json()).approvalsWaiting;

  test("T9. counts the waiting sends with an applied draft: 1 for the owner and the member; 0 with the flag off", async () => {
    const s = await setup();
    await t2Data(s);
    expect(await waiting(s, "owner")).toBe(1);
    expect(await waiting(s, "member")).toBe(1);
    // The other organization has none of these sends.
    expect(await waiting(s, "other")).toBe(0);
    await setOrgFeature(db, s.ctx, { flag: "approvals_page", enabled: false, actor: "cli", now: NOW });
    expect(await waiting(s, "owner")).toBe(0);
    expect(await waiting(s, "member")).toBe(0);
  });

  test("a send of the other organization does not count", async () => {
    const s = await setup();
    await addSend(s.org.otherOrgId, s.theirMailboxId);
    expect(await waiting(s, "owner")).toBe(0);
    expect(await waiting(s, "other")).toBe(1);
  });
});
