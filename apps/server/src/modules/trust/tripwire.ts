// The tripwire (ADR 0028, ticket F110 stage 09): a category that the user keeps correcting loses its `auto`, once, with one notice per owner.
// Two causes: user corrections of the moves of the category after its grant (`tripwireDue`), and a `fail` of the history check that
// ended after the grant. The job reads the corrections with one query per organization and writes each trip in one transaction under
// the settings row lock. Logs hold the organization, the mailbox, the category and a reason code: never a mail id or a mail value.
import {
  movingCategories,
  parseCategoryPolicy,
  TRIP_WINDOW_DAYS,
  tripwireDue,
  type CategoryGrant,
  type MovingCategory,
  type TripReason,
} from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listMoveCorrections, type MoveCorrection } from "../actions";
import { trustSettingsUrlOf, queueTrustNotice } from "../channels";
import { listAssistPolicies, lockMailboxSettings, setCategoryAuto, type SettingsDeps } from "../config";
import { type TestMailRule } from "../mail";
import { isFeatureOn, isOrgSuspended, listOrganizations } from "../tenancy";

import { insertTrip, newestDoneCheck, type HistoryResult } from "./repo";

const log = createLog("trust");

const DAY_MS = 86_400_000;
// A correction is important when the user needed the mail that the move hid.
const isImportant = (row: MoveCorrection): boolean =>
  row.trueCategory === "urgent" || row.trueCategory === "needs_reply";

export interface TripwireDeps {
  db: Db;
  /** The setters' deps (`settingsDeps`): the pause is `setCategoryAuto` with `auto: false`, so it expires the `ready` moves too. */
  settings: SettingsDeps;
  testMail: TestMailRule;
  /** `WEB_BASE_URL`: the settings link of the notice; absent: the text has no link. */
  webBaseUrl?: string;
  /** Test seam: runs after the reads and before the write of a trip (a user can change `auto` in between). */
  hooks?: { beforeTrip?: () => void | Promise<void> };
}

// A category with `auto` on and a grant, in an `assist` mailbox: the only ones the tripwire watches. A mailbox with `auto` and no
// grant (set before F110) has no grant time to count from; the re-gate stamps it, and from then on it is watched.
interface Watched {
  mailboxId: string;
  category: MovingCategory;
  grant: CategoryGrant;
  grantedAt: Date;
}

async function watchedOf(db: Db, ctx: TenantContext): Promise<Watched[]> {
  const watched: Watched[] = [];
  for (const row of await listAssistPolicies(db, ctx)) {
    let policy;
    try {
      policy = parseCategoryPolicy(row.categoryPolicy);
    } catch (error) {
      // One bad row must not stop the other mailboxes (and it is not a trip).
      log.with({ org_id: ctx.orgId, mailbox_id: row.mailboxId }).warn("tripwire_policy_unreadable", errorFields(error));
      continue;
    }
    for (const category of movingCategories) {
      const entry = policy[category];
      if (entry?.auto !== true || entry.grant === undefined) continue;
      watched.push({ mailboxId: row.mailboxId, category, grant: entry.grant, grantedAt: new Date(entry.grant.at) });
    }
  }
  return watched;
}

interface Due {
  reason: TripReason;
  counts: Record<string, number>;
  /** The count that the notice of the reason `corrections` prints. */
  corrections: number;
}

// The corrections of one granted category: both times (the move and the correction) after the grant, one per mail, in the window.
function correctionsDue(corrections: readonly MoveCorrection[], watch: Watched, now: Date): Due | null {
  const counted = new Map<string, MoveCorrection>();
  for (const row of corrections) {
    if (row.mailboxId !== watch.mailboxId || row.category !== watch.category) continue;
    if (row.correctedAt.getTime() <= watch.grantedAt.getTime()) continue;
    if (row.appliedAt.getTime() <= watch.grantedAt.getTime()) continue;
    counted.set(row.emailId, row);
  }
  const rows = [...counted.values()];
  const reason = tripwireDue({
    corrections: rows.map((row) => ({ at: row.correctedAt, important: isImportant(row) })),
    now,
  });
  if (reason === null) return null;
  const from = now.getTime() - TRIP_WINDOW_DAYS * DAY_MS;
  const inWindow = rows.filter(
    (row) => row.correctedAt.getTime() >= from && row.correctedAt.getTime() <= now.getTime()
  );
  const important = inWindow.filter(isImportant).length;
  return { reason, counts: { corrections: inWindow.length, important }, corrections: inWindow.length };
}

// A `fail` of the newest `done` check that ended after the grant. A `forced` grant is the user's choice against the evidence.
function historyFailDue(
  check: { result: HistoryResult | null; finishedAt: Date | null } | null,
  watch: Watched
): Due | null {
  if (watch.grant.by === "forced") return null;
  const entry = check?.result?.[watch.category];
  if (check === null || entry === undefined || entry.outcome !== "fail") return null;
  if (check.finishedAt === null || check.finishedAt.getTime() <= watch.grantedAt.getTime()) return null;
  return {
    reason: "history_fail",
    counts: { acted: entry.acted, moved: entry.moved, total: entry.total },
    corrections: 0,
  };
}

// One trip: the settings row is locked first, and the pause runs only when the category still holds the grant that was judged. A
// user who turned `auto` off and on again meanwhile has a new grant: this trip is stale and writes nothing.
async function trip(deps: TripwireDeps, ctx: TenantContext, watch: Watched, due: Due, now: Date): Promise<boolean> {
  await deps.hooks?.beforeTrip?.();
  const tripped = await deps.db.transaction().execute(async (trx) => {
    const row = await lockMailboxSettings(trx, ctx, watch.mailboxId);
    if (row === undefined || row.mode !== "assist") return false;
    const entry = parseCategoryPolicy(row.category_policy)[watch.category];
    if (entry?.auto !== true || entry.grant?.at !== watch.grant.at) return false;
    const tripId = await insertTrip(trx, ctx, {
      mailboxId: watch.mailboxId,
      category: watch.category,
      grantedAt: watch.grantedAt,
      reason: due.reason,
      counts: due.counts,
    });
    // Null: this grant has its trip already; nothing more happens.
    if (tripId === null) return false;
    await setCategoryAuto({ ...deps.settings, db: trx }, ctx, watch.mailboxId, {
      category: watch.category,
      auto: false,
      gate: { decision: "skipped", precision: null, kept: 0, forced: false },
      grantBy: "evidence",
      auditData: { reason: "tripwire", trip_reason: due.reason, ...due.counts },
      actor: "system",
    });
    await queueTrustNotice(trx, ctx, {
      kind: "autonomy_paused",
      mailboxId: watch.mailboxId,
      tripId,
      now,
      view: {
        mailboxId: watch.mailboxId,
        category: watch.category,
        reason: due.reason,
        corrections: due.corrections,
        settingsUrl: trustSettingsUrlOf(deps.webBaseUrl),
      },
    });
    return true;
  });
  if (tripped) {
    log
      .with({ org_id: ctx.orgId, mailbox_id: watch.mailboxId })
      .info("autonomy_tripped", { category: watch.category, reason: due.reason });
  }
  return tripped;
}

async function runOrg(deps: TripwireDeps, ctx: TenantContext, now: Date): Promise<number> {
  const watched = await watchedOf(deps.db, ctx);
  if (watched.length === 0) return 0;
  const since = new Date(now.getTime() - TRIP_WINDOW_DAYS * DAY_MS);
  const corrections = await listMoveCorrections(deps.db, ctx, since, deps.testMail);
  const checks = new Map<string, Awaited<ReturnType<typeof newestDoneCheck>>>();
  let count = 0;
  for (const watch of watched) {
    let due = correctionsDue(corrections, watch, now);
    if (due === null && watch.grant.by !== "forced") {
      if (!checks.has(watch.mailboxId))
        checks.set(watch.mailboxId, await newestDoneCheck(deps.db, ctx, watch.mailboxId));
      due = historyFailDue(checks.get(watch.mailboxId) ?? null, watch);
    }
    if (due === null) continue;
    try {
      if (await trip(deps, ctx, watch, due, now)) count += 1;
    } catch (error) {
      // The next run tries again: a failed trip is rolled back as a whole, so no half pause exists.
      log.with({ org_id: ctx.orgId, mailbox_id: watch.mailboxId }).error("tripwire_failed", errorFields(error));
    }
  }
  return count;
}

/**
 * One pass over every organization with `trust_ladder` on that is not suspended. Returns how many categories it paused. A failure
 * in one organization is a log line and does not stop the others.
 */
export async function runTripwire(deps: TripwireDeps, now: Date): Promise<{ tripped: number }> {
  let tripped = 0;
  for (const org of await listOrganizations(deps.db)) {
    const ctx = { orgId: org.id };
    try {
      if (!(await isFeatureOn(deps.db, ctx, "trust_ladder")) || (await isOrgSuspended(deps.db, ctx))) continue;
      tripped += await runOrg(deps, ctx, now);
    } catch (error) {
      log.with({ org_id: org.id }).warn("tripwire_org_failed", errorFields(error));
    }
  }
  return { tripped };
}

/** The scheduled job: `trust.tripwire`, every 60 s (it needs no model, so it runs with the triage scope off too). */
export function createTripwireJob(deps: TripwireDeps & { now(): Date }): { run(): Promise<void> } {
  return {
    async run() {
      await runTripwire(deps, deps.now());
    },
  };
}
