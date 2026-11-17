// The re-gate of `auto` (ADR 0028, rule 16 of the product rules): after a switch of model, prompt or endpoint, `auto` stays on only where the
// running key has evidence. It runs once at start, before the triage worker and the committer exist (a `ready` move planned under the
// old key meets the new policy), and every 5 minutes as a safety net. Always on: the global evidence belongs to the model, not to the
// flag `trust_ladder`. Every mailbox is one transaction under the settings lock; ids, codes and counts only in the logs.
import {
  autoFor,
  barCategories,
  parseCategoryPolicy,
  sameKey,
  type BarCategory,
  type CategoryGrant,
  type CategoryPolicy,
  type GateEvidenceDeps,
  type TripReason,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { queueTrustNotice, trustSettingsUrlOf } from "../channels";
import {
  lockMailboxSettings,
  setCategoryAuto,
  setCategoryGrants,
  SettingsNotFoundError,
  type SettingsDeps,
} from "../config";
import type { TestMailRule } from "../mail";
import { isFeatureOn } from "../tenancy";
import { globalEvidenceFor } from "../triage";

import { readCategoryEvidence } from "./gate";
import { insertTrip, listMailboxesWithAuto, queueHistoryCheck } from "./repo";

const log = createLog("trust");

export type RegateRun = "start" | "job";

export interface RegateDeps {
  /** A transaction is allowed (the tests roll their rows back); the job passes the pool. */
  db: Db | Transaction<DB>;
  /** The global evidence of the running classifier: the gate files of the image and the running key. */
  gate: GateEvidenceDeps;
  testMail: TestMailRule;
  /** The setters' deps over one transaction (the composition root builds them: `config` sits below `trust`). */
  settingsOf(trx: Transaction<DB>): SettingsDeps;
  /** `WEB_BASE_URL`: the settings link of the notice; absent: the text has no link. */
  webBaseUrl?: string;
  /** Which run this is: `start` (once, before the workers) or `job` (the safety net); it goes to the `trust_regate_done` line. */
  run: RegateRun;
  /** Test seam: runs after the settings lock of a mailbox is taken. */
  hooks?: { afterLock?: (ctx: TenantContext, mailboxId: string) => void | Promise<void> };
}

export interface RegateResult {
  stamped: number;
  regranted: number;
  paused: number;
}

const ACTOR = "system";

// A grant that the evidence made (not the user's force, not the old state): a newer no-go file for the same key withdraws it.
// `legacy`, `forced` and `real_labels` grants never had a global file behind them.
const EVIDENCE_GRANTS: readonly CategoryGrant["by"][] = ["evidence", "recommended", "regate"];

type Decision =
  | { kind: "stamp"; category: BarCategory }
  | { kind: "regrant"; category: BarCategory; from: CategoryGrant }
  | {
      kind: "pause";
      category: BarCategory;
      reason: Extract<TripReason, "model_switch" | "evidence_changed">;
      grant: CategoryGrant;
    };

async function decideCategory(
  trx: Transaction<DB>,
  deps: RegateDeps,
  ctx: TenantContext,
  mailboxId: string,
  policy: CategoryPolicy,
  category: BarCategory,
  now: Date
): Promise<Decision | null> {
  const grant = policy[category]?.grant;
  if (grant === undefined) return { kind: "stamp", category };
  const runningKey = deps.gate.runningKey;
  if (sameKey(grant.key, runningKey)) {
    if (!EVIDENCE_GRANTS.includes(grant.by)) return null;
    const global = globalEvidenceFor(deps.gate.index, runningKey)[category];
    // A final file that says no-go (or too few cases) for this key now: the evidence of the grant is gone. A provisional file or no file
    // leaves the grant as it is.
    const withdrawn = !global.provisional && (global.decision === "no-go" || global.decision === "too-few");
    return withdrawn ? { kind: "pause", category, reason: "evidence_changed", grant } : null;
  }
  if (grant.by !== "forced") {
    const { result } = await readCategoryEvidence(trx, ctx, mailboxId, category, {
      gate: deps.gate,
      testMail: deps.testMail,
      now,
    });
    if (result.eligible) return { kind: "regrant", category, from: grant };
  }
  return { kind: "pause", category, reason: "model_switch", grant };
}

// The date of a trip is the date of the grant it ends. A grant date that does not parse (the field is any string) falls back to now.
function grantedAtOf(grant: CategoryGrant, now: Date): Date {
  const at = new Date(grant.at);
  return Number.isNaN(at.getTime()) ? now : at;
}

async function regateMailbox(
  deps: RegateDeps,
  ctx: TenantContext,
  mailboxId: string,
  now: Date
): Promise<RegateResult> {
  const total: RegateResult = { stamped: 0, regranted: 0, paused: 0 };
  const body = async (trx: Transaction<DB>): Promise<void> => {
    const row = await lockMailboxSettings(trx, ctx, mailboxId);
    if (row === undefined) throw new SettingsNotFoundError();
    await deps.hooks?.afterLock?.(ctx, mailboxId);
    const policy = parseCategoryPolicy(row.category_policy);
    const settings = deps.settingsOf(trx);
    const decisions: Decision[] = [];
    for (const category of barCategories) {
      if (!autoFor(policy, category)) continue;
      const decision = await decideCategory(trx, deps, ctx, mailboxId, policy, category, now);
      if (decision !== null) decisions.push(decision);
    }
    const stamps = decisions.filter((decision) => decision.kind === "stamp");
    if (stamps.length > 0) {
      await setCategoryGrants(settings, ctx, mailboxId, {
        categories: stamps.map((decision) => decision.category),
        by: "legacy",
        actor: ACTOR,
      });
      total.stamped += stamps.length;
    }
    for (const decision of decisions) {
      if (decision.kind === "regrant") {
        await setCategoryGrants(settings, ctx, mailboxId, {
          categories: [decision.category],
          by: "regate",
          from: decision.from.key,
          actor: ACTOR,
        });
        total.regranted += 1;
      } else if (decision.kind === "pause") {
        await pauseCategory(trx, deps, settings, ctx, mailboxId, decision, now);
        total.paused += 1;
      }
    }
    // The history result belongs to the old key: a new check for the new key (a stale `fail` blocks until a newer check ends).
    if ((total.regranted > 0 || total.paused > 0) && (await isFeatureOn(trx, ctx, "trust_ladder"))) {
      await queueHistoryCheck(trx, ctx, mailboxId, "model_switch");
    }
  };
  await (deps.db.isTransaction ? body(deps.db as Transaction<DB>) : deps.db.transaction().execute(body));
  return total;
}

// `auto` off (the ready moves and mark-reads of the category expire as `policy_changed`), the trip and the notice, in one transaction.
// The unique key of the trip is `(mailbox, category, granted_at)`: a trip that exists already means another process paused it, so no
// second notice.
async function pauseCategory(
  trx: Transaction<DB>,
  deps: RegateDeps,
  settings: SettingsDeps,
  ctx: TenantContext,
  mailboxId: string,
  decision: Extract<Decision, { kind: "pause" }>,
  now: Date
): Promise<void> {
  await setCategoryAuto(settings, ctx, mailboxId, {
    category: decision.category,
    auto: false,
    gate: { decision: "skipped", precision: null, kept: 0, forced: false },
    grantBy: "evidence",
    auditData: { reason: decision.reason },
    actor: ACTOR,
    inTransaction: async (inner) => {
      const tripId = await insertTrip(inner, ctx, {
        mailboxId,
        category: decision.category,
        grantedAt: grantedAtOf(decision.grant, now),
        reason: decision.reason,
        counts: {},
      });
      if (tripId === null) return;
      await queueTrustNotice(inner, ctx, {
        kind: "autonomy_paused",
        mailboxId,
        tripId,
        now,
        view: {
          mailboxId,
          category: decision.category,
          reason: decision.reason,
          corrections: 0,
          settingsUrl: trustSettingsUrlOf(deps.webBaseUrl),
        },
      });
    },
  });
}

/**
 * Runs the re-gate over every mailbox of every organization that is not suspended. A mailbox that fails is logged and left for the next
 * run; the others go on. Two runs at once give one trip and one notice per category: the second waits for the settings lock and then
 * finds `auto` off (and the unique key of the trip stops a double notice).
 */
export async function regateAll(deps: RegateDeps, now: Date): Promise<RegateResult> {
  const total: RegateResult = { stamped: 0, regranted: 0, paused: 0 };
  let failed = 0;
  for (const target of await listMailboxesWithAuto(deps.db)) {
    const ctx = { orgId: target.orgId };
    try {
      const one = await regateMailbox(deps, ctx, target.mailboxId, now);
      total.stamped += one.stamped;
      total.regranted += one.regranted;
      total.paused += one.paused;
    } catch (error) {
      failed += 1;
      log
        .with({ org_id: target.orgId, mailbox_id: target.mailboxId })
        .error("trust_regate_mailbox_failed", { ...errorFields(error) });
    }
  }
  log.info("trust_regate_done", { ...total, run: deps.run, failed });
  return total;
}
