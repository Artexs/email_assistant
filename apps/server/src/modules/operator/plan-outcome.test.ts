import { describe, expect, test } from "bun:test";

import type { OrgPlanState, SetOrgPlanResult } from "../tenancy";

import { planOutcomeOf } from "./service";

// Golden: the answers of `POST /api/operator/orgs/:orgId/plan` as the route built them before the mapping moved into the service.
const before: OrgPlanState = {
  plan: "trial",
  trialEndsAt: new Date("2026-12-04T10:00:00.000Z"),
  maxMailboxes: 3,
  resumedAt: null,
};
const after: OrgPlanState = {
  plan: "active",
  trialEndsAt: null,
  maxMailboxes: 5,
  resumedAt: new Date("2026-11-18T09:00:00.000Z"),
};

const outcome = (result: SetOrgPlanResult) => {
  const { status, body } = planOutcomeOf(result);
  return { status, body: JSON.stringify(body) };
};

describe("planOutcomeOf", () => {
  test("the three error kinds keep their status and body", () => {
    expect(outcome({ kind: "not_found" })).toEqual({ status: 404, body: '{"error":"not_found"}' });
    expect(outcome({ kind: "trial_days_needed" })).toEqual({ status: 400, body: '{"error":"trial_days_needed"}' });
    expect(outcome({ kind: "bad_input", reason: "trial_days_range" })).toEqual({
      status: 400,
      body: '{"error":"trial_days_range"}',
    });
  });

  test("unchanged answers the state with zero counts", () => {
    expect(outcome({ kind: "unchanged", state: before })).toEqual({
      status: 200,
      body:
        '{"result":"unchanged","plan":"trial","trialEndsAt":"2026-12-04T10:00:00.000Z","maxMailboxes":3,' +
        '"resumedAt":null,"cancelledMessages":0,"expiredSends":0}',
    });
  });

  test("changed answers the new state with the counts of the change", () => {
    expect(outcome({ kind: "changed", before, after, cancelledMessages: 2, expiredSends: 1 })).toEqual({
      status: 200,
      body:
        '{"result":"changed","plan":"active","trialEndsAt":null,"maxMailboxes":5,' +
        '"resumedAt":"2026-11-18T09:00:00.000Z","cancelledMessages":2,"expiredSends":1}',
    });
  });

  test("the log kind is the service kind", () => {
    expect(planOutcomeOf({ kind: "bad_input", reason: "nothing_to_change" }).kind).toBe("bad_input");
    expect(planOutcomeOf({ kind: "unchanged", state: before }).kind).toBe("unchanged");
  });
});
