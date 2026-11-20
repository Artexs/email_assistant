import { replySamplesQueuedSchema, replySamplesViewSchema, MINUTE_MS, DAY_MS } from "@ea/core";
import { quotaDayStart, QUOTA_TIMEZONE } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { updateMailboxSettings } from "../../src/modules/config";
import { clearReplyTexts, replyRoutes, replySampleScope, sampleReplies } from "../../src/modules/replies";
import { countSampleRequestsSince, listSampleRequests } from "../../src/modules/replies/repo/samples";

import { testDb } from "./helpers";
import {
  addReplyMail,
  fakeLlm,
  jobDeps,
  llmCallRows,
  NOW,
  queueRequest,
  requestsOf,
  runJob,
  type FakeAnswer,
  type JobBox,
  type MailOpts,
} from "./reply-job-fixtures";
import { as, webTestApp } from "./web-helpers";
import { post, replyWebKit } from "./web-reply-kit";

// Sample drafts: `POST` and `GET /api/mailboxes/:id/reply-samples`, the job step of a `sample` request, the day limit and the gates.
// Committed rows (the reply web kit); the fake model never leaves the process.
const db = testDb();
const kit = replyWebKit(db);

afterEach(async () => {
  await kit.cleanup();
});

afterAll(async () => {
  await db.destroy();
});

const BODIES = [
  "Dzień dobry,\n\nTak, wtorek mi pasuje.",
  "Dzień dobry,\n\nTak, środa mi pasuje.",
  "Dzień dobry,\n\nTak, czwartek mi pasuje.",
  "Dzień dobry,\n\nTak, piątek mi pasuje.",
];

// A model that answers a different text to each call, so the stored samples can be told apart.
const varied = (call: number): FakeAnswer => ({
  decision: "draft",
  reason_code: null,
  body: BODIES[(call - 1) % BODIES.length] ?? "",
  gaps: [],
  language: "pl",
});

const sampleUrl = (mailboxId: string) => `/api/mailboxes/${mailboxId}/reply-samples`;

interface Options {
  mode?: "shadow" | "assist";
  flags?: Parameters<typeof kit.setup>[0];
  samples?: boolean;
}

// A shadow mailbox (no drafts are made there), the reply routes with the sample routes, and the clock of the kit.
async function world(opts: Options = {}) {
  const w = await kit.setup(opts.flags ?? {});
  await db
    .transaction()
    .execute((trx) => updateMailboxSettings(trx, w.box.ctx, w.box.mailboxId, { mode: opts.mode ?? "shadow" }));
  const app = webTestApp({
    db,
    sessions: { owner: w.org.ownerId, member: w.org.assistantId, other: w.org.otherOwnerId },
    routers: (api) =>
      api.route(
        "/",
        replyRoutes({
          db,
          preview: null,
          ...(opts.samples === false ? {} : { samples: { now: () => kit.clock.now, testOnly: null } }),
        })
      ),
  });
  return { ...w, app };
}

type World = Awaited<ReturnType<typeof world>>;

const mail = (box: JobBox, opts: MailOpts = {}) => db.transaction().execute((trx) => addReplyMail(trx, box, opts));

const ago = (minutes: number): Date => new Date(NOW.getTime() - minutes * MINUTE_MS);

// Four eligible mails: the newest first in the result.
async function fourMails(box: JobBox): Promise<[string, string, string, string]> {
  return [
    await mail(box, { receivedAt: ago(10) }),
    await mail(box, { receivedAt: ago(20) }),
    await mail(box, { receivedAt: ago(30) }),
    await mail(box, { receivedAt: ago(40) }),
  ];
}

async function ask(w: World, who = "owner", mailboxId = w.box.mailboxId) {
  return w.app.request(sampleUrl(mailboxId), post(who));
}

async function runDrafter(w: World, over: Parameters<typeof jobDeps>[3] = {}, script = varied) {
  const fake = fakeLlm(script);
  await runJob(jobDeps(db, fake.llm, kit.clock, over), w.box);
  return fake.requests.length;
}

const actionRows = (w: World) => db.selectFrom("actions").select("id").where("org_id", "=", w.box.ctx.orgId).execute();
const outboxRows = (w: World) => db.selectFrom("outbox").select("id").where("org_id", "=", w.box.ctx.orgId).execute();

describe("POST and GET /api/mailboxes/:id/reply-samples", () => {
  test("a shadow mailbox with four eligible mails gets three samples on the newest mails and writes nothing else", async () => {
    const w = await world();
    const [newest, second, third, oldest] = await fourMails(w.box);

    const res = await ask(w);
    expect(res.status).toBe(202);
    const queued = replySamplesQueuedSchema.parse(await res.json());
    expect(queued.count).toBe(3);
    expect(queued.requestIds).toHaveLength(3);

    const requests = await requestsOf(db, w.box);
    expect(requests.map((r) => r.id).sort()).toEqual([...queued.requestIds].sort());
    expect(requests.every((r) => r.trigger === "sample" && r.requested_by === w.box.userId)).toBe(true);
    expect(requests.map((r) => r.email_id).sort()).toEqual([newest, second, third].sort());
    expect(requests.map((r) => r.email_id)).not.toContain(oldest);

    // Before the job: the panel sees the three requests and no text.
    const waiting = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()
    );
    expect(waiting.items.map((i) => [i.status, i.body])).toEqual([
      ["pending", null],
      ["pending", null],
      ["pending", null],
    ]);

    expect(await runDrafter(w)).toBe(3);
    const done = await requestsOf(db, w.box);
    expect(done.map((r) => r.status)).toEqual(["done", "done", "done"]);
    const bodies = done.map((r) => r.sample_body);
    expect(bodies.every((b) => typeof b === "string" && b.length > 0)).toBe(true);
    expect(new Set(bodies).size).toBe(3);
    // A sample writes no action (so no Drafts copy follows), no send, no notice and no result row.
    expect(await actionRows(w)).toEqual([]);
    expect(await outboxRows(w)).toEqual([]);
    expect(done.every((r) => r.send_action_id === null)).toBe(true);

    const view = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()
    );
    expect(view.items.map((i) => i.status)).toEqual(["done", "done", "done"]);
    expect(view.items.map((i) => i.body).sort()).toEqual([...bodies].sort());
    expect(view.items.every((i) => i.subject === "Spotkanie we wtorek")).toBe(true);
  });

  test("each sample call counts in the cap of the mailbox, and a sample at the cap fails with llm_cap", async () => {
    const w = await world();
    await fourMails(w.box);
    await ask(w);
    // A cap of 2: the first two calls pass, the third finds the cap reached.
    await runDrafter(w, { dailyCap: 2 });
    const requests = await requestsOf(db, w.box);
    expect(requests.map((r) => [r.status, r.reason_code]).sort()).toEqual([
      ["done", null],
      ["done", null],
      ["failed", "llm_cap"],
    ]);
    expect((await llmCallRows(db, w.box)).length).toBe(2);
  });

  test("a second run on the same day answers 409 sample_limit and queues nothing", async () => {
    const w = await world();
    await fourMails(w.box);
    expect((await ask(w)).status).toBe(202);
    const before = (await requestsOf(db, w.box)).length;
    const again = await ask(w);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "sample_limit" });
    expect((await requestsOf(db, w.box)).length).toBe(before);
    // The limit holds after the run is done, and the next quota day gives a new run.
    await runDrafter(w);
    expect((await ask(w)).status).toBe(409);
    kit.clock.now = new Date(NOW.getTime() + 2 * DAY_MS);
    try {
      expect((await ask(w)).status).toBe(202);
    } finally {
      kit.clock.now = NOW;
    }
  });

  test("the day limit belongs to one mailbox, and a tap or a redraft of the day does not use it up", async () => {
    const w = await world();
    await fourMails(w.box);
    const second = await kit.addMailbox(w.org.orgId);
    const secondBox: JobBox = { ...w.box, mailboxId: second.id, address: second.address };
    await mail(secondBox);
    // A tap request of the first mailbox, made today, is no sample run.
    const tapped = await mail(w.box, { receivedAt: ago(50) });
    await queueRequest(db, w.box, tapped, "tap");
    expect((await ask(w)).status).toBe(202);
    expect((await ask(w)).status).toBe(409);
    // The second mailbox has its own run.
    expect((await ask(w, "owner", second.id)).status).toBe(202);
    expect((await requestsOf(db, secondBox)).map((r) => r.trigger)).toEqual(["sample"]);
  });

  test("the run list shows today's run only: a run of an earlier day is not shown", async () => {
    const w = await world();
    await fourMails(w.box);
    await ask(w);
    await runDrafter(w);
    const shown = async () =>
      replySamplesViewSchema.parse(await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()).items;
    expect(await shown()).toHaveLength(3);
    kit.clock.now = new Date(NOW.getTime() + 2 * DAY_MS);
    try {
      expect(await shown()).toEqual([]);
    } finally {
      kit.clock.now = NOW;
    }
  });

  test("a paused or auth_error mailbox queues nothing and uses up no day: count 0, and the run works again when the mailbox is active", async () => {
    const w = await world();
    await fourMails(w.box);
    for (const status of ["paused", "auth_error"] as const) {
      await db.updateTable("mailboxes").set({ status }).where("id", "=", w.box.mailboxId).execute();
      const res = await ask(w);
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ requestIds: [], count: 0 });
      expect(await requestsOf(db, w.box)).toEqual([]);
    }
    await db.updateTable("mailboxes").set({ status: "active" }).where("id", "=", w.box.mailboxId).execute();
    const res = await ask(w);
    expect(res.status).toBe(202);
    expect(replySamplesQueuedSchema.parse(await res.json()).count).toBe(3);
  });

  test("two runs at the same time make one run", async () => {
    const w = await world();
    await fourMails(w.box);
    const answers = await Promise.all([ask(w), ask(w), ask(w)]);
    expect(answers.map((r) => r.status).sort()).toEqual([202, 409, 409]);
    expect((await requestsOf(db, w.box)).length).toBe(3);
  });

  test("one eligible mail gives one sample and the answer says count 1; none gives count 0 and uses no run", async () => {
    const w = await world();
    const res = await ask(w);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ requestIds: [], count: 0 });
    expect(await requestsOf(db, w.box)).toEqual([]);

    const only = await mail(w.box);
    const one = await ask(w);
    expect(one.status).toBe(202);
    const queued = replySamplesQueuedSchema.parse(await one.json());
    expect(queued.count).toBe(1);
    expect((await requestsOf(db, w.box)).map((r) => r.email_id)).toEqual([only]);
  });

  test("only mail that passes the sample rules is used: needs_reply, last 7 days, a person, not answered", async () => {
    const w = await world();
    const good = await mail(w.box, { receivedAt: ago(60) });
    await mail(w.box, { category: "info", receivedAt: ago(5) });
    await mail(w.box, { category: "urgent", receivedAt: ago(6) });
    await mail(w.box, { receivedAt: new Date(NOW.getTime() - 8 * DAY_MS) });
    await mail(w.box, { from: "no-reply@client.test", receivedAt: ago(7) });
    const answered = await mail(w.box, { receivedAt: ago(8) });
    await db
      .insertInto("email_flags")
      .values({
        email_id: answered,
        org_id: w.box.ctx.orgId,
        answered: true,
        checked_at: NOW,
        seen: true,
        flagged: false,
      })
      .execute();
    await mail(w.box, { receivedAt: ago(9), headers: false });

    const res = await ask(w);
    expect(replySamplesQueuedSchema.parse(await res.json()).count).toBe(1);
    expect((await requestsOf(db, w.box)).map((r) => r.email_id)).toEqual([good]);
  });

  test("the samples work in assist mode too, and a mail with an automatic request is still a candidate", async () => {
    const w = await world({ mode: "assist" });
    const first = await mail(w.box, { receivedAt: ago(10) });
    expect((await ask(w)).status).toBe(202);
    expect((await requestsOf(db, w.box)).map((r) => r.email_id)).toEqual([first]);
  });

  test("an OAuth mailbox answers 409 blocked with the reason and queues nothing", async () => {
    const w = await world();
    await fourMails(w.box);
    await db.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", w.box.mailboxId).execute();
    const res = await ask(w);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "blocked", reason: "oauth_mailbox" });
    expect(await requestsOf(db, w.box)).toEqual([]);
  });

  test("a request that the drafter ends with no draft shows its status and no text", async () => {
    const w = await world();
    await mail(w.box);
    await ask(w);
    await runDrafter(w, {}, () => ({
      decision: "no_draft",
      reason_code: "needs_facts",
      body: "",
      gaps: [],
      language: "pl",
    }));
    const view = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()
    );
    expect(view.items).toMatchObject([{ status: "no_draft", reasonCode: "needs_facts", body: null }]);
  });

  test("a text on a request that is not done is never shown", async () => {
    const w = await world();
    await mail(w.box);
    await ask(w);
    await db
      .updateTable("reply_requests")
      .set({ sample_body: "Dzień dobry, to nie powinno być widać." })
      .where("mailbox_id", "=", w.box.mailboxId)
      .execute();
    const view = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()
    );
    expect(view.items).toMatchObject([{ status: "pending", body: null }]);
  });

  test("the flag is checked when the job runs: a sample is cancelled while the flag is off", async () => {
    const w = await world();
    await mail(w.box);
    await ask(w);
    await w.setFlags({ reply_drafts: false });
    expect(await runDrafter(w)).toBe(0);
    const [request] = await requestsOf(db, w.box);
    expect(request).toMatchObject({ status: "cancelled", reason_code: "feature_off", sample_body: null });
  });

  test("retention clears the sample text and the panel then sees no text", async () => {
    const w = await world();
    await mail(w.box);
    await ask(w);
    await runDrafter(w);
    const cleared = await clearReplyTexts(db, w.box.ctx, { before: new Date(NOW.getTime() + DAY_MS) });
    expect(cleared).toBe(1);
    const [row] = await requestsOf(db, w.box);
    expect(row?.sample_body).toBeNull();
    const view = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()
    );
    expect(view.items).toMatchObject([{ status: "done", body: null }]);
  });

  test("the run writes one audit row for each request with ids and codes and no text", async () => {
    const w = await world();
    await fourMails(w.box);
    await ask(w);
    await runDrafter(w);
    const rows = await db
      .selectFrom("audit_log")
      .select(["event", "actor", "data"])
      .where("org_id", "=", w.box.ctx.orgId)
      .where("event", "=", "reply.requested")
      .execute();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.actor).toBe(w.box.userId);
      expect(Object.keys(row.data as object).sort()).toEqual(["reply_request_id", "trigger", "via"]);
      expect(row.data).toMatchObject({ via: "web", trigger: "sample" });
    }
    expect(JSON.stringify(rows)).not.toContain("wtorek");
  });
});

describe("the gates of the sample routes", () => {
  test("401 without a session, 403 for a member (POST and GET), 404 for a bad id", async () => {
    const w = await world();
    await fourMails(w.box);
    const origin = { origin: "http://127.0.0.1:8080" };
    expect((await w.app.request(sampleUrl(w.box.mailboxId), { method: "POST", headers: origin })).status).toBe(401);
    expect((await w.app.request(sampleUrl(w.box.mailboxId), { headers: origin })).status).toBe(401);
    expect((await ask(w, "member")).status).toBe(403);
    expect((await w.app.request(sampleUrl(w.box.mailboxId), as("member"))).status).toBe(403);
    // The role comes before the id: a member gets 403 for a bad id too.
    expect((await w.app.request("/api/mailboxes/not-a-uuid/reply-samples", post("member"))).status).toBe(403);
    expect((await w.app.request("/api/mailboxes/not-a-uuid/reply-samples", as("member"))).status).toBe(403);
    expect((await w.app.request("/api/mailboxes/not-a-uuid/reply-samples", post("owner"))).status).toBe(404);
    expect((await w.app.request("/api/mailboxes/not-a-uuid/reply-samples", as("owner"))).status).toBe(404);
    expect(await requestsOf(db, w.box)).toEqual([]);
  });

  test("a mailbox of another organization answers 404 on both routes and nothing is queued", async () => {
    const w = await world();
    await fourMails(w.theirBox);
    const res = await ask(w, "owner", w.theirBox.mailboxId);
    expect(res.status).toBe(404);
    expect((await w.app.request(sampleUrl(w.theirBox.mailboxId), as("owner"))).status).toBe(404);
    expect(await requestsOf(db, w.theirBox)).toEqual([]);
    // The owner of the other organization is not blocked by it.
    expect((await ask(w, "other", w.theirBox.mailboxId)).status).toBe(202);
  });

  test("the samples of one organization are not shown to another", async () => {
    const w = await world();
    await mail(w.box);
    await mail(w.theirBox);
    await ask(w);
    await runDrafter(w);
    const mine = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.box.mailboxId), as("owner"))).json()
    );
    expect(mine.items).toHaveLength(1);
    const theirs = replySamplesViewSchema.parse(
      await (await w.app.request(sampleUrl(w.theirBox.mailboxId), as("other"))).json()
    );
    expect(theirs.items).toEqual([]);
  });

  test("the flag off answers 404 for every role on both routes, also for a bad id, and queues nothing", async () => {
    const w = await world({ flags: { reply_drafts: false } });
    await fourMails(w.box);
    for (const who of ["owner", "member"]) {
      for (const id of [w.box.mailboxId, w.theirBox.mailboxId, "not-a-uuid"]) {
        const url = `/api/mailboxes/${id}/reply-samples`;
        expect({ who, id, post: (await w.app.request(url, post(who))).status }).toEqual({ who, id, post: 404 });
        expect({ who, id, get: (await w.app.request(url, as(who))).status }).toEqual({ who, id, get: 404 });
      }
    }
    expect(await requestsOf(db, w.box)).toEqual([]);
  });

  test("the flag is checked before the model: flag off and no model client still answers 404", async () => {
    const w = await world({ flags: { reply_drafts: false }, samples: false });
    expect((await ask(w)).status).toBe(404);
  });

  test("with no model client the run answers 409 llm_off and queues nothing", async () => {
    const w = await world({ samples: false });
    await fourMails(w.box);
    const res = await ask(w);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "llm_off" });
    expect(await requestsOf(db, w.box)).toEqual([]);
  });
});

describe("the model scope of the samples", () => {
  test("under the synthetic scope only test mail is sampled; real mail gets no request and the day is not used up", async () => {
    const w = await world();
    const testSender = `probe-${w.box.mailboxId}@test.example`;
    const real = await mail(w.box, { receivedAt: ago(10) });
    const probe = await mail(w.box, { receivedAt: ago(20), from: testSender });
    const synthetic = { db, now: () => NOW, testOnly: { senders: [testSender] } };
    const input = { mailboxId: w.box.mailboxId, userId: w.box.userId, via: "web", count: 3 } as const;
    const answer = await sampleReplies(synthetic, w.box.ctx, input);
    expect(answer).toMatchObject({ kind: "queued", count: 1 });
    expect((await requestsOf(db, w.box)).map((r) => r.email_id)).toEqual([probe]);
    // With no scope (null) the real mail is a candidate: the second run is the limit, so a new mailbox state shows the filter alone.
    await db.deleteFrom("reply_requests").where("mailbox_id", "=", w.box.mailboxId).execute();
    const all = await sampleReplies({ ...synthetic, testOnly: null }, w.box.ctx, input);
    expect(all).toMatchObject({ kind: "queued", count: 2 });
    expect((await requestsOf(db, w.box)).map((r) => r.email_id).sort()).toEqual([real, probe].sort());
  });

  test("the composition root maps the scope of the job: synthetic gives its test-mail rule, all gives none", () => {
    const rule = { senders: ["probe@test.example"] };
    const now = () => NOW;
    expect(replySampleScope({ kind: "synthetic", testMail: rule }, now)).toEqual({ now, testOnly: rule });
    expect(replySampleScope({ kind: "all" }, now)).toEqual({ now, testOnly: null });
  });
});

describe("the sample service and its readers", () => {
  test("the service refuses a member and a closed flag, and never queues more than three", async () => {
    const w = await world();
    await fourMails(w.box);
    const deps = { db, now: () => NOW, testOnly: null };
    const member = await sampleReplies(deps, w.box.ctx, {
      mailboxId: w.box.mailboxId,
      userId: w.org.assistantId,
      via: "web",
      count: 3,
    });
    expect(member).toEqual({ kind: "forbidden" });
    const wide = await sampleReplies(deps, w.box.ctx, {
      mailboxId: w.box.mailboxId,
      userId: w.box.userId,
      via: "web",
      count: 99,
    });
    expect(wide).toMatchObject({ kind: "queued", count: 3 });
    await w.setFlags({ reply_drafts: false });
    const off = await sampleReplies(deps, w.box.ctx, {
      mailboxId: w.box.mailboxId,
      userId: w.box.userId,
      via: "web",
      count: 3,
    });
    expect(off).toEqual({ kind: "feature_off" });
  });

  test("the readers filter the organization: another organization's context sees no request of this mailbox", async () => {
    const w = await world();
    await fourMails(w.box);
    await ask(w);
    const since = quotaDayStart(NOW, QUOTA_TIMEZONE);
    expect(await countSampleRequestsSince(db, w.box.ctx, w.box.mailboxId, since)).toBe(3);
    expect(await countSampleRequestsSince(db, w.theirBox.ctx, w.box.mailboxId, since)).toBe(0);
    expect(await listSampleRequests(db, w.box.ctx, w.box.mailboxId, since)).toHaveLength(3);
    expect(await listSampleRequests(db, w.theirBox.ctx, w.box.mailboxId, since)).toEqual([]);
  });
});
