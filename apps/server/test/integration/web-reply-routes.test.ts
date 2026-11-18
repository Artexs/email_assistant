import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { captureLogs } from "../log-capture";

import { testDb } from "./helpers";
import { fakeLlm, jobDeps, NOW, runJob, type FakeAnswer } from "./reply-job-fixtures";
import { as } from "./web-helpers";
import { post, replyWebKit } from "./web-reply-kit";

// The write routes of the reply drafts in the panel, from the request to the new version. The model is a fake and no SMTP runs.
const db = testDb();
const kit = replyWebKit(db);

afterEach(async () => {
  await kit.cleanup();
});
afterAll(async () => {
  await db.destroy();
});

const LINE = "SECRET-LINE-4f1c tell them no";

async function auditOf(orgId: string) {
  return db
    .selectFrom("audit_log")
    .select(["event", "actor", "data", "reason_code", "action_id"])
    .where("org_id", "=", orgId)
    .execute();
}

// A request of the model: the instruction reaches the prompt as data only.
async function draftWith(boxId: Parameters<typeof runJob>[1], answer: FakeAnswer, seen: string[] = []) {
  const { llm, requests } = fakeLlm(() => answer);
  await runJob(jobDeps(db, llm, { now: NOW }), boxId);
  seen.push(...requests.map((request) => JSON.stringify(request)));
  return requests.length;
}

describe("POST /api/replies and GET /api/replies/requests/:id", () => {
  test("1. a clean mail: 202 with a request id; the status is pending, then done with the send; a second request answers 200 with the send", async () => {
    const w = await kit.setup();
    const emailId = await kit.mailOf(w.box);

    const first = await w.app.request("/api/replies", post("owner", { emailId }));
    expect(first.status).toBe(202);
    const { requestId } = (await first.json()) as { requestId: string };
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    // A second request while the first waits is the same request (no second model call).
    const again = await w.app.request("/api/replies", post("owner", { emailId }));
    expect({ status: again.status, body: await again.json() }).toEqual({ status: 202, body: { requestId } });

    const waiting = await w.app.request(`/api/replies/requests/${requestId}`, as("owner"));
    expect(await waiting.json()).toEqual({ status: "pending", reasonCode: null, sendId: null });

    expect(await kit.runDrafter(w.box)).toBe(1);
    const send = await db
      .selectFrom("actions")
      .select("id")
      .where("org_id", "=", w.box.ctx.orgId)
      .where("type", "=", "send")
      .executeTakeFirstOrThrow();

    const done = await w.app.request(`/api/replies/requests/${requestId}`, as("member"));
    expect(await done.json()).toEqual({ status: "done", reasonCode: null, sendId: send.id });

    const open = await w.app.request("/api/replies", post("owner", { emailId }));
    expect({ status: open.status, body: await open.json() }).toEqual({ status: 200, body: { sendId: send.id } });
  });

  test("2. the request row and the audit row: requested by the owner, `via: web`, ids and codes only", async () => {
    const w = await kit.setup();
    const emailId = await kit.mailOf(w.box);
    const res = await w.app.request("/api/replies", post("owner", { emailId, instruction: LINE }));
    const { requestId } = (await res.json()) as { requestId: string };

    const row = await db
      .selectFrom("reply_requests")
      .select(["trigger", "requested_by", "status", "email_id", "mailbox_id", "instruction"])
      .where("id", "=", requestId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      trigger: "tap",
      requested_by: w.org.ownerId,
      status: "pending",
      email_id: emailId,
      mailbox_id: w.box.mailboxId,
    });
    expect(row.instruction).toBe(LINE);
    const audit = (await auditOf(w.box.ctx.orgId)).filter((entry) => entry.event === "reply.requested");
    expect(audit).toEqual([
      {
        event: "reply.requested",
        actor: w.org.ownerId,
        data: { via: "web", trigger: "tap", reply_request_id: requestId },
        reason_code: null,
        action_id: null,
      },
    ]);
  });

  test("3. a flagged mail answers 409 blocked / suspicious; a mail of the owner's own mailbox 409 / own_mailbox; nothing is queued", async () => {
    const w = await kit.setup();
    const flagged = await kit.mailOf(w.box);
    await db
      .updateTable("triage_results")
      .set({ suspicious_reasons: ["reply_to_mismatch"] })
      .where("email_id", "=", flagged)
      .execute();
    const own = await kit.mailOf(w.box, { from: w.box.address });

    for (const [emailId, reason] of [
      [flagged, "suspicious"],
      [own, "own_mailbox"],
    ] as const) {
      const res = await w.app.request("/api/replies", post("owner", { emailId }));
      expect({ status: res.status, body: await res.json() }).toEqual({
        status: 409,
        body: { error: "blocked", reason },
      });
    }
    const rows = await db.selectFrom("reply_requests").select("id").where("org_id", "=", w.box.ctx.orgId).execute();
    expect(rows).toEqual([]);
  });

  test("4. an unknown mail, a mail of the other organization and a mailbox switched off answer 404 or 409 and queue nothing", async () => {
    const w = await kit.setup();
    const theirs = await kit.mailOf(w.theirBox);
    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const emailId of [theirs, unknown]) {
      const res = await w.app.request("/api/replies", post("owner", { emailId }));
      expect({ status: res.status, body: await res.json() }).toEqual({ status: 404, body: { error: "not_found" } });
    }
    const mine = await kit.mailOf(w.box);
    await db
      .updateTable("mailbox_settings")
      .set({ mode: "shadow" })
      .where("mailbox_id", "=", w.box.mailboxId)
      .execute();
    const res = await w.app.request("/api/replies", post("owner", { emailId: mine }));
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 409,
      body: { error: "blocked", reason: "policy_changed" },
    });
    expect(await db.selectFrom("reply_requests").select("id").where("org_id", "=", w.box.ctx.orgId).execute()).toEqual(
      []
    );
  });
});

describe("POST /api/approvals/:id/redraft", () => {
  test("5. a line makes a request; the job writes version 2 with the line as data; the old send is superseded; the answer, logs and audit rows never hold the line", async () => {
    const w = await kit.setup();
    const { sendId } = await kit.draftOf(w.box);
    const logs = captureLogs();
    const prompts: string[] = [];
    try {
      const res = await w.app.request(`/api/approvals/${sendId}/redraft`, post("owner", { instruction: LINE }));
      const text = await res.text();
      expect(res.status).toBe(202);
      expect(text).not.toContain("SECRET-LINE");
      const { requestId } = JSON.parse(text) as { requestId: string };

      expect(await draftWith(w.box, { ...answerOf("Nie, dziękuję.") }, prompts)).toBe(1);
      // The line reached the model, as data.
      expect(prompts.join("")).toContain("SECRET-LINE-4f1c");

      const status = await w.app.request(`/api/replies/requests/${requestId}`, as("owner"));
      const { sendId: next, status: end } = (await status.json()) as { sendId: string; status: string };
      expect(end).toBe("done");
      expect(next).not.toBe(sendId);

      const old = await w.app.request(`/api/approvals/${sendId}`, as("owner"));
      expect(await old.json()).toMatchObject({ state: "superseded", currentId: next });
      const detail = (await (await w.app.request(`/api/approvals/${next}`, as("owner"))).json()) as {
        version: number;
        instruction: string;
        redraftsLeft: number;
      };
      expect(detail).toMatchObject({ version: 2, instruction: LINE, redraftsLeft: 4 });
    } finally {
      logs.stop();
    }
    expect(logs.lines.join("\n")).not.toContain("SECRET-LINE");
    const audit = await auditOf(w.box.ctx.orgId);
    expect(JSON.stringify(audit)).not.toContain("SECRET-LINE");
    expect(audit.find((entry) => entry.event === "reply.requested")?.data).toMatchObject({
      via: "web",
      trigger: "redraft",
    });
  });

  test("6. a line of 301 characters answers 400 validation and no row; so do an empty line, a line with only control characters and an unknown key", async () => {
    const w = await kit.setup();
    const { sendId } = await kit.draftOf(w.box);
    const bodies: unknown[] = [
      { instruction: "x".repeat(301) },
      { instruction: "" },
      { instruction: "\u0000\u0007‮" },
      { instruction: "x".repeat(1001) },
      { instruction: "ok", extra: 1 },
      {},
    ];
    for (const body of bodies) {
      const res = await w.app.request(`/api/approvals/${sendId}/redraft`, post("owner", body));
      const text = await res.text();
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
      expect(JSON.parse(text)).toMatchObject({ error: "validation" });
      expect(text).not.toContain("xxxx");
    }
    const exact = await w.app.request(
      `/api/approvals/${sendId}/redraft`,
      post("owner", { instruction: "x".repeat(300) })
    );
    expect(exact.status).toBe(202);
    const rows = await db
      .selectFrom("reply_requests")
      .select("id")
      .where("org_id", "=", w.box.ctx.orgId)
      .where("trigger", "=", "redraft")
      .execute();
    expect(rows).toHaveLength(1);
  });

  test("7. a superseded send answers 409 changed with the newest id; a send that was approved answers 409 closed; the sixth redraft answers 409 redraft_limit", async () => {
    const w = await kit.setup();
    const { sendId, emailId } = await kit.draftOf(w.box);
    await kit.addresses(emailId, { to: [w.box.address, "b@y.test"] });
    const all = await w.app.request(`/api/approvals/${sendId}/recipients`, post("owner", { mode: "all" }));
    const { id: current } = (await all.json()) as { id: string };

    const old = await w.app.request(`/api/approvals/${sendId}/redraft`, post("owner", { instruction: "again" }));
    expect({ status: old.status, body: await old.json() }).toEqual({
      status: 409,
      body: { error: "changed", currentId: current },
    });

    for (let n = 0; n < 5; n += 1) {
      await db
        .insertInto("reply_requests")
        .values({
          org_id: w.box.ctx.orgId,
          mailbox_id: w.box.mailboxId,
          email_id: emailId,
          thread_key: "t",
          folder: "INBOX",
          trigger: "redraft",
          status: "failed",
          requested_by: w.org.ownerId,
        })
        .execute();
    }
    const limit = await w.app.request(`/api/approvals/${current}/redraft`, post("owner", { instruction: "again" }));
    expect({ status: limit.status, body: await limit.json() }).toEqual({
      status: 409,
      body: { error: "redraft_limit" },
    });

    await kit.applyDrafts(w.box);
    const approve = await w.app.request(`/api/approvals/${current}/approve`, post("owner"));
    expect(approve.status).toBe(200);
    const closed = await w.app.request(`/api/approvals/${current}/redraft`, post("owner", { instruction: "again" }));
    expect({ status: closed.status, body: await closed.json() }).toEqual({
      status: 409,
      body: { error: "closed", state: "held" },
    });
  });
});

function answerOf(body: string) {
  return { decision: "draft", reason_code: null, body, gaps: [], language: "pl" };
}
