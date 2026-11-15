import type { LiveRunPlan, Scenario, UrgencyProfile } from "@ea/core";

import type { Db } from "../../platform/db";
import { setUrgencyProfile } from "../config";

import type { LabOrg } from "./state";

export interface UrgencyDeps {
  db: Db;
  scenario: Scenario;
}

// The urgency profile of a run: the scenario topics, and the deadlines of the run plan (shifted onto the real dates).
// `start` stores it on the lab mailbox; the triage prompt reads it from there. Returns true when the stored profile changed.
export async function storeRunUrgencyProfile(deps: UrgencyDeps, org: LabOrg, plan: LiveRunPlan): Promise<boolean> {
  const profile: UrgencyProfile = {
    topics: deps.scenario.urgency.profile.topics,
    deadlines: plan.deadlines,
  };
  const { changed } = await setUrgencyProfile(deps.db, { orgId: org.orgId }, org.mailboxId, profile, { via: "cli" });
  return changed;
}
