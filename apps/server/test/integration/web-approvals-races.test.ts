import { approvalConflictSchema, approvalDetailSchema, MINUTE_MS, HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, afterEach, describe, expect, test } from "bun:test";

import { ACTION_STATUSES } from "../../src/modules/actions/transitions";

import { testDb } from "./helpers";
import { approvalKit, NOW, post, type Seed } from "./web-approvals-kit";
import { as } from "./web-helpers";

// Approvals write API: one name for one closed send, races between the three writes, and the limit of a send that nobody was told about.
const db = testDb();
const { cleanup, setup, addSend, send, auditOf, editRows, sendCount } = approvalKit(db);

afterEach(cleanup);

afterAll(async () => {
  await db.destroy();
});

type Route = "approve" | "reject" | "edit";
interface Answer {
  status: number;
  body: unknown;
}

const call = async (s: Seed, id: string, route: Route, body: unknown = {}): Promise<Answer> => {
  const res = await s.app.request(`/api/approvals/${id}/${route}`, post("owner", route, body));
  return { status: res.status, body: await res.json() };
};
const EDIT = { subject: "S", body: "B" };
const countOf = (rows: { event: string }[], event: string) => rows.filter((row) => row.event === event).length;
const approved = { userId: "", at: NOW };

describe("one send has one name in approve, reject, edit and the detail", () => {
  test("every closed status gets the name of the detail route in all three writes", async () => {
    const s = await setup();
    const by = { ...approved, userId: s.org.ownerId };
    const cases: { name: string; state: string; opts: Parameters<typeof addSend>[1] }[] = [
      { name: "applied", state: "sent", opts: { sendStatus: "applied", approved: by } },
      { name: "applying", state: "sending", opts: { sendStatus: "applying", approved: by } },
      {
        name: "approved, a run holds it",
        state: "sending",
        opts: { sendStatus: "approved", approved: by, lockedAt: new Date(NOW.getTime() - MINUTE_MS) },
      },
      { name: "rejected", state: "rejected", opts: { sendStatus: "rejected" } },
      { name: "expired", state: "expired", opts: { sendStatus: "expired" } },
      { name: "failed", state: "failed", opts: { sendStatus: "failed" } },
    ];
    for (const { name, state, opts } of cases) {
      const id = await addSend(s, opts);
      const detail = approvalDetailSchema.parse(
        await (await s.app.request(`/api/approvals/${id}`, as("owner"))).json()
      );
      expect({ name, detail: String(detail.state) }).toEqual({ name, detail: state });
      for (const route of ["approve", "reject", "edit"] as const) {
        const answer = await call(s, id, route, route === "edit" ? EDIT : {});
        expect({ name, route, ...answer }).toEqual({ name, route, status: 409, body: { error: "closed", state } });
        // The schema of the apiDoc accepts exactly the names that the detail route uses.
        expect(approvalConflictSchema.safeParse(answer.body).success).toBe(true);
      }
    }
  });

  test("a send whose status is not a send state (logged, undone) is 404 in the detail and all three writes, never 500", async () => {
    const s = await setup();
    // A plan that never reached approval stays `logged` (shadow mode, `create_draft` off) when the mailbox goes to assist mode.
    // Every status of the enum is listed: a new status fails here until it gets a name or a place in the list.
    const named = ["awaiting_approval", "approved", "applying", "applied", "rejected", "expired", "failed"];
    const notSendStates = ACTION_STATUSES.filter((status) => !named.includes(status));
    expect(notSendStates).toEqual(["ready", "undone", "logged"]);
    // The database refuses a send in `ready` (`actions_send_never_ready_check`), so no such row exists to read.
    for (const status of notSendStates.filter((status) => status !== "ready")) {
      const id = await addSend(s, { sendStatus: status });
      const detail = await s.app.request(`/api/approvals/${id}`, as("owner"));
      expect({ dbStatus: status, route: "detail", code: detail.status }).toEqual({
        dbStatus: status,
        route: "detail",
        code: 404,
      });
      for (const route of ["approve", "reject", "edit"] as const) {
        const answer = await call(s, id, route, route === "edit" ? EDIT : {});
        expect({ dbStatus: status, route, ...answer }).toEqual({
          dbStatus: status,
          route,
          status: 404,
          body: { error: "not_found" },
        });
      }
      expect((await send(id)).status).toBe(status);
    }
  });

  test("a held send (approved, no run holds it) is `held` in the detail and in the edit; approve is not an error", async () => {
    const s = await setup();
    const id = await addSend(s, { sendStatus: "approved", approved: { ...approved, userId: s.org.ownerId } });
    const detail = approvalDetailSchema.parse(await (await s.app.request(`/api/approvals/${id}`, as("owner"))).json());
    expect(detail.state).toBe("held");
    expect(await call(s, id, "edit", EDIT)).toEqual({ status: 409, body: { error: "closed", state: "held" } });
    expect(await call(s, id, "approve")).toEqual({ status: 200, body: { status: "approved" } });
  });

  test("a replaced send is `changed` in all three writes and `superseded` in the detail", async () => {
    const s = await setup();
    const id = await addSend(s);
    const edited = await call(s, id, "edit", EDIT);
    const currentId = (edited.body as { id: string }).id;
    const detail = approvalDetailSchema.parse(await (await s.app.request(`/api/approvals/${id}`, as("owner"))).json());
    expect(detail).toMatchObject({ state: "superseded", currentId });
    for (const route of ["approve", "reject", "edit"] as const) {
      const answer = await call(s, id, route, route === "edit" ? { subject: "T", body: "C" } : {});
      expect(answer).toEqual({ status: 409, body: { error: "changed", currentId } });
    }
  });
});

describe("a send that no owner was told about (no notified_at)", () => {
  test("older than 7 days: approve expires it as not_notified; no mail goes out", async () => {
    const s = await setup();
    const id = await addSend(s, { notifiedAt: null, createdAt: new Date(NOW.getTime() - 7 * DAY_MS - HOUR_MS) });
    expect(await call(s, id, "approve")).toEqual({ status: 409, body: { error: "closed", state: "expired" } });
    expect(await send(id)).toMatchObject({ status: "expired", status_reason: "not_notified", approved_by: null });
    // The same expiry path as the 48 h one: each owner's card (the seed gives both) gets the expired edit.
    expect((await editRows(s.org.orgId)).map((row) => row.dedup_key.split(":").pop())).toEqual(["expired", "expired"]);
  });

  test("younger than 7 days: the panel approves it (no 48 h limit without a notice)", async () => {
    const s = await setup();
    const id = await addSend(s, { notifiedAt: null, createdAt: new Date(NOW.getTime() - 6 * DAY_MS) });
    expect(await call(s, id, "approve")).toEqual({ status: 200, body: { status: "approved" } });
    expect(await send(id)).toMatchObject({ status: "approved", approved_via: "web" });
  });
});

// Real overlap: the requests run on separate connections of the pool. The row lock of `lockSend`, the status guard of `setApproved` and the
// lock of `editApproval` make the end state one of the allowed ones; a test loops because one run can win the race by luck.
const RUNS = 8;

describe("races between the write routes", () => {
  test("two approves at once: both 200 approved, one audit row", async () => {
    const s = await setup();
    for (let run = 0; run < RUNS; run++) {
      const id = await addSend(s);
      const [a, b] = await Promise.all([call(s, id, "approve"), call(s, id, "approve")]);
      expect([a, b]).toEqual([
        { status: 200, body: { status: "approved" } },
        { status: 200, body: { status: "approved" } },
      ]);
      expect(countOf(await auditOf(id), "action.approved")).toBe(1);
      expect((await send(id)).status).toBe("approved");
    }
  });

  test("approve and reject at once: the send ends rejected, never approved after the reject", async () => {
    const s = await setup();
    for (let run = 0; run < RUNS; run++) {
      const id = await addSend(s);
      const [a, r] = await Promise.all([call(s, id, "approve"), call(s, id, "reject")]);
      expect(r).toEqual({ status: 200, body: { status: "rejected" } });
      expect([200, 409]).toContain(a.status);
      if (a.status === 409) expect(a.body).toEqual({ error: "closed", state: "rejected" });
      expect((await send(id)).status).toBe("rejected");
      const audit = await auditOf(id);
      expect(countOf(audit, "action.approved")).toBeLessThanOrEqual(1);
      expect(countOf(audit, "action.rejected")).toBe(1);
    }
  });

  test("approve and edit at once: exactly one 200; the other answers 409 closed or changed", async () => {
    const s = await setup();
    for (let run = 0; run < RUNS; run++) {
      const id = await addSend(s);
      const before = await sendCount(s.org.orgId);
      const [a, e] = await Promise.all([
        call(s, id, "approve"),
        call(s, id, "edit", { subject: `Race ${run}`, body: "Changed body" }),
      ]);
      expect([a.status, e.status].filter((status) => status === 200)).toHaveLength(1);
      if (a.status === 200) {
        expect(e.body).toEqual({ error: "closed", state: "held" });
        expect((await send(id)).status).toBe("approved");
        expect(await sendCount(s.org.orgId)).toBe(before);
      } else {
        const newId = (e.body as { id: string }).id;
        expect(a.body).toEqual({ error: "changed", currentId: newId });
        expect((await send(id)).status).toBe("expired");
        expect((await send(newId)).status).toBe("awaiting_approval");
        expect(countOf(await auditOf(id), "action.approved")).toBe(0);
      }
    }
  });
});
