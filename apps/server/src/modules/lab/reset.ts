import type { Db } from "../../platform/db";
import { listMailboxes } from "../mail";
import type { OrgDeleteExpect, OrgDeleteScopedResult } from "../privacy";
import { getOrganization, listMemberships } from "../tenancy";

import type { LabMailAdmin } from "./mail-client";
import type { RunSpend } from "./run-spend";
import type { SeedResult, SeedTarget } from "./seed";
import { stopLabRun, type StartInput, type StartRefusal, type StartResult } from "./start";
import type { LabOrg, LabOrgKey, LabState } from "./state";

// The reset of one lab organization. It DELETES data: the organization that `orgs.json` names for the
// key, its rows, and the mail in its GreenMail mailbox. Four guards stand before the first delete; each one alone refuses:
//   1. the name of the organization is `targets[key].orgName`;
//   2. the mailbox address in `orgs.json` is `targets[key].mailbox`;
//   3. every mailbox row of the organization has the address `targets[key].mailbox` (a real mailbox refuses it);
//   4. every member of the organization has the email `targets[key].mailbox` (the seed uses the mailbox address as the
//      owner email; a real user in the org refuses it).
// Guards 3 and 4 run twice: before the first change (so a refusal changes nothing), and again INSIDE the delete
// transaction under the organization lock (`deleteOrg` gets `expect`), so a mailbox or a member added in between
// is never deleted.
// The mailbox that is emptied is always `targets[key].mailbox`, never a value read from the database. The mail
// client refuses any address outside the scenario addresses (`address_refused`). The other lab organization, its
// mailbox and its runs are never touched.

export type ResetErrorCode =
  | "org_mismatch"
  // The delete function refused on its own name check: nothing is deleted.
  | "delete_refused"
  | "delete_busy"
  | "start_refused";

export class LabResetError extends Error {
  constructor(
    readonly code: ResetErrorCode,
    readonly detail?: StartRefusal
  ) {
    super(code);
    this.name = "LabResetError";
  }
}

export interface LabOrgRow {
  name: string;
  /** The address of every mailbox row of the organization. */
  mailboxes: string[];
  /** The email of every member of the organization. */
  members: string[];
}

/** The real lookup: the organization row, its mailbox addresses and its member emails; undefined when the org does not exist. */
export function createOrgLookup(db: Db): (orgId: string) => Promise<LabOrgRow | undefined> {
  return async (orgId) => {
    const org = await getOrganization(db, { orgId });
    if (org === undefined) return undefined;
    return {
      name: org.name,
      mailboxes: (await listMailboxes(db, { orgId })).map((row) => row.address),
      members: (await listMemberships(db, { orgId })).map((row) => row.email),
    };
  };
}

export interface ResetDeps {
  /** What a lab org must be: the name and the mailbox of each key. The CLI passes `LAB_TARGETS`; a test passes a random mailbox. */
  targets: Record<LabOrgKey, SeedTarget>;
  lookupOrg(orgId: string): Promise<LabOrgRow | undefined>;
  state: LabState;
  mail: LabMailAdmin;
  /**
   * The privacy module's organization delete (`deleteOrganization`), the function the `org:delete` CLI uses. `expect`
   * is the scope check inside its transaction; `scope_mismatch` means a mailbox or a member outside it.
   */
  deleteOrg(input: { orgId: string; confirmName: string; expect: OrgDeleteExpect }): Promise<OrgDeleteScopedResult>;
  seed(target: SeedTarget): Promise<SeedResult>;
  /** The spend of a run, read before its org rows go: the ledger line of a stopped run needs it. */
  spendOf(runId: string): Promise<RunSpend>;
  /** `startLabRun` over the deps of the CLI. */
  start(input: StartInput): Promise<StartResult>;
  now(): Date;
}

export interface ResetPreview {
  /** The organization the reset deletes; undefined on a first reset (no entry, or its organization is gone). */
  orgId: string | undefined;
  mailbox: string;
  /** Mails in all folders of the mailbox. */
  messages: number;
}

// Step 2. Returns the entry and whether its organization still exists; undefined when `orgs.json` has no entry.
// Throws `org_mismatch` and changes nothing.
async function checkLabOrg(deps: ResetDeps, key: LabOrgKey): Promise<{ entry: LabOrg; exists: boolean } | undefined> {
  const entry = deps.state.readOrgs()[key];
  if (entry === undefined) return undefined;
  const target = deps.targets[key];
  const org = await deps.lookupOrg(entry.orgId);
  // The organization is gone: a crash after the delete and before `orgs.json` changed. Nothing is left to delete.
  if (org === undefined) return { entry, exists: false };
  if (org.name !== target.orgName) throw new LabResetError("org_mismatch");
  if (entry.address !== target.mailbox) throw new LabResetError("org_mismatch");
  if (org.mailboxes.some((address) => address !== target.mailbox)) throw new LabResetError("org_mismatch");
  if (org.members.some((email) => email !== target.mailbox)) throw new LabResetError("org_mismatch");
  return { entry, exists: true };
}

/** What a reset would delete. It runs the guards, so a mismatch fails here too, and it writes nothing. */
export async function previewReset(deps: ResetDeps, key: LabOrgKey): Promise<ResetPreview> {
  const checked = await checkLabOrg(deps, key);
  const { mailbox } = deps.targets[key];
  return {
    orgId: checked?.exists === true ? checked.entry.orgId : undefined,
    mailbox,
    messages: await deps.mail.countMessages(mailbox),
  };
}

// Step 3: ends each run of the org that has no `stopped` event. The ledger line is part of `stopLabRun`; its spend
// is read before step 4 deletes the org rows.
async function stopRunsOf(deps: ResetDeps, key: LabOrgKey): Promise<void> {
  const { state } = deps;
  for (const runId of state.listRuns()) {
    if (state.readRun(runId).org !== key) continue;
    if (state.events(runId).some((event) => event.t === "stopped")) continue;
    const spend = await deps.spendOf(runId);
    stopLabRun(state, runId, spend.usd, deps.now());
  }
}

/**
 * Rebuilds the lab organization of `key` from nothing. Each step can run again: a
 * crash after the delete leaves no entry (or an entry of a gone org) and the next call goes on at step 5.
 * `deleted` is false when no organization was deleted (a first reset, or its organization was already gone).
 */
export async function resetOrg(deps: ResetDeps, key: LabOrgKey): Promise<{ orgId: string; deleted: boolean }> {
  const target = deps.targets[key];
  const checked = await checkLabOrg(deps, key);
  // Before the first delete: a mailbox the client refuses, or a GreenMail that does not answer, stops the reset here.
  await deps.mail.countMessages(target.mailbox);
  let deleted = false;
  if (checked !== undefined) {
    await stopRunsOf(deps, key);
    if (checked.exists) {
      const result = await deps.deleteOrg({
        orgId: checked.entry.orgId,
        confirmName: target.orgName,
        expect: { mailboxes: [target.mailbox], memberEmails: [target.mailbox] },
      });
      if (result.kind === "busy") throw new LabResetError("delete_busy");
      // A mailbox or a member that appeared after the first check: nothing is deleted.
      if (result.kind === "scope_mismatch") throw new LabResetError("org_mismatch");
      if (result.kind === "name_mismatch") throw new LabResetError("delete_refused");
      deleted = result.kind === "deleted";
    }
    const kept = Object.entries(deps.state.readOrgs()).filter(([name]) => name !== key);
    deps.state.writeOrgs(Object.fromEntries(kept));
  }
  await deps.mail.emptyMailbox(target.mailbox);
  const { org } = await deps.seed(target);
  return { orgId: org.orgId, deleted };
}

// The demo week: shadow for days 1 to 3, assist from day 4.
const DEMO_ASSIST_FROM_DAY = 4;

/** `resetOrg("demo")`, then a week run for the demo org with the shadow-then-assist plan (step 7). */
export async function resetDemo(
  deps: ResetDeps,
  opts: { startDate?: string }
): Promise<{ orgId: string; runId: string }> {
  const { orgId } = await resetOrg(deps, "demo");
  const result = await deps.start({
    mode: "week",
    org: "demo",
    reuse: false,
    modePlan: { assistFromDay: DEMO_ASSIST_FROM_DAY },
    ...(opts.startDate === undefined ? {} : { date: opts.startDate }),
  });
  if (result.kind === "refused") throw new LabResetError("start_refused", result.code);
  return { orgId, runId: result.run.plan.runId };
}
