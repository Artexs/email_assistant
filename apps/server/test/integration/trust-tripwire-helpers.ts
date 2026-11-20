import {
  barCategories,
  type BarCategory,
  type Category,
  type CategoryGrantBy,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GlobalEvidence,
  MINUTE_MS,
} from "@ea/core";
import { sql } from "kysely";

import { settingsDeps } from "../../src/composition";
import { insertDefaultSettings } from "../../src/modules/config";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createTripwireJob, type TripwireDeps } from "../../src/modules/trust";
import type { Db, TenantContext } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTriagedWithActions, linkChat, randomChatId } from "./fixtures";
import { insertCheckRow } from "./trust-fixtures";

// Committed organizations for the tests of the tripwire. The job writes in transactions of its own, so these tests
// cannot run in a rolled-back transaction. Every test removes its organizations and users in `finally`.
export const RUNNING_KEY: EvidenceKey = {
  provider: "gemini",
  model: "tripwire-test-model",
  reasoningEffort: null,
  promptVersion: "v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

export const GRANT_AT = "2026-11-01T10:00:00.000Z";
export const NOW = new Date("2026-11-08T12:00:00Z");
export const at = (iso: string): Date => new Date(iso);

// A non-provisional `go` for every category under the running key: the evidence gate lets `auto` on.
export const GO_GATE: GateEvidenceDeps = (() => {
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    categories[category] = {
      decision: "go",
      provisional: false,
      precision: 0.99,
      wilsonLower: 0.97,
      threshold: 0.8,
      cases: 200,
      file: "classifier-tripwire.json",
    };
  }
  return {
    index: {
      files: [
        { key: RUNNING_KEY, file: "classifier-tripwire.json", date: "2026-11-01", provisional: false, categories },
      ],
    },
    runningKey: RUNNING_KEY,
  };
})();

export interface Grant {
  category: "info" | "notification" | "spam";
  at?: string;
  by?: CategoryGrantBy;
}

export interface TripBox extends TenantContext {
  mailboxId: string;
  owner1: string;
  owner2: string;
}

export interface BoxOptions {
  mode?: "assist" | "shadow";
  grants?: Grant[];
  flag?: boolean;
  /** An `auto` entry with no grant (a row from before the ladder). */
  legacyAutoOn?: Grant["category"][];
}

/** A committed organization: two linked owners (one reads Polish), a mailbox in `assist`, `trust_ladder` on, and the grants. */
export async function withTripBox(conn: Db, opts: BoxOptions, run: (box: TripBox) => Promise<void>): Promise<void> {
  const created = await conn.transaction().execute((trx) => createOrgWithMailbox(trx));
  const ctx: TenantContext = { orgId: created.orgId };
  const owner2 = await conn.transaction().execute(async (trx) => {
    const id = await addMember(trx, created.orgId, "owner");
    await trx.updateTable("users").set({ locale: "pl" }).where("id", "=", id).execute();
    await linkChat(trx, ctx, created.userId, randomChatId(), NOW);
    await linkChat(trx, ctx, id, randomChatId(), NOW);
    return id;
  });
  try {
    await insertDefaultSettings(conn, ctx, created.mailboxId);
    const policy: Record<string, unknown> = {};
    for (const grant of opts.grants ?? []) {
      policy[grant.category] = {
        auto: true,
        threshold: 0.8,
        grant: { key: RUNNING_KEY, by: grant.by ?? "evidence", at: grant.at ?? GRANT_AT },
      };
    }
    for (const category of opts.legacyAutoOn ?? []) policy[category] = { auto: true, threshold: 0.8 };
    await conn
      .updateTable("mailbox_settings")
      .set({ mode: opts.mode ?? "assist", category_policy: JSON.stringify(policy) })
      .where("mailbox_id", "=", created.mailboxId)
      .execute();
    if (opts.flag !== false) {
      await setOrgFeature(conn, ctx, { flag: "trust_ladder", enabled: true, actor: created.userId, now: NOW });
    }
    await run({ ...ctx, mailboxId: created.mailboxId, owner1: created.userId, owner2 });
  } finally {
    await conn.deleteFrom("organizations").where("id", "=", created.orgId).execute();
    await conn.deleteFrom("users").where("id", "in", [created.userId, owner2]).execute();
  }
}

/** The tripwire over a connection; the settings deps carry the running key of the tests. */
export function tripwireOf(conn: Db, over: Partial<TripwireDeps> = {}, now: () => Date = () => NOW) {
  return createTripwireJob({
    db: conn,
    settings: settingsDeps(conn, now, GO_GATE),
    testMail: { senders: [] },
    webBaseUrl: "https://app.example.test",
    now,
    ...over,
  });
}

export interface Move {
  category: Category;
  /** When the move took effect; the triage result is one minute older. Default `applied` 2026-11-02T09:00Z. */
  appliedAt?: string;
  status?: "applied" | "undone" | "logged" | "ready" | "failed" | "expired";
  from?: string;
  /** The triage result is older than the grant by default; `createdAt` moves it. */
  createdAt?: string;
}

/** A triaged mail with its original `move` action. Returns the mail id. */
export async function addMove(conn: Db, box: TripBox, move: Move): Promise<string> {
  const appliedAt = at(move.appliedAt ?? "2026-11-02T09:00:00Z");
  const status = move.status ?? "applied";
  return conn.transaction().execute(async (trx) => {
    const { emailId } = await insertTriagedWithActions(trx, box, box.mailboxId, {
      category: move.category,
      createdAt: at(move.createdAt ?? new Date(appliedAt.getTime() - MINUTE_MS).toISOString()),
      ...(move.from === undefined ? {} : { from: move.from }),
      actions: [
        {
          type: "move",
          status,
          payload: { folder: "newsletters" },
          appliedAt,
        },
      ],
    });
    return emailId;
  });
}

/** A newer triage result of the mail (a later re-triage); the move keeps the category of the result that planned it. */
export async function addLaterResult(conn: Db, box: TripBox, emailId: string, category: Category, when: string) {
  await conn
    .insertInto("triage_results")
    .values({
      org_id: box.orgId,
      email_id: emailId,
      category,
      confidence: 0.9,
      reason_code: "direct_request",
      fields: "{}",
      created_at: at(when),
    })
    .execute();
}

export interface Feedback {
  at: string;
  verdict?: "right" | "wrong";
  trueCategory?: Category | null;
  source?: "undo" | "web" | "telegram" | "imap_move" | "review" | "cli";
}

export async function addFeedback(conn: Db, box: TripBox, emailId: string, feedback: Feedback): Promise<void> {
  await conn
    .insertInto("triage_feedback")
    .values({
      org_id: box.orgId,
      email_id: emailId,
      source: feedback.source ?? "undo",
      verdict: feedback.verdict ?? "wrong",
      true_category: feedback.trueCategory === undefined ? "info" : feedback.trueCategory,
      created_at: at(feedback.at),
    })
    .execute();
}

/** A move and the user's `wrong` verdict on it. */
export async function addCorrected(conn: Db, box: TripBox, move: Move, feedback: Feedback): Promise<string> {
  const emailId = await addMove(conn, box, move);
  await addFeedback(conn, box, emailId, feedback);
  return emailId;
}

/** A `done` history check that ended at `finishedAt` with one outcome per listed category. */
export async function addCheck(
  conn: Db,
  box: TripBox,
  finishedAt: string,
  outcomes: Partial<Record<Grant["category"], "fail" | "pass" | "inconclusive">>
): Promise<void> {
  const entry = { acted: 12, moved: 3, upper: 0.5, total: 100, wouldMove: 40 };
  const result = Object.fromEntries(
    Object.entries(outcomes).map(([category, outcome]) => [category, { ...entry, outcome }])
  );
  await conn.transaction().execute((trx) =>
    insertCheckRow(trx, box, box.mailboxId, {
      status: "done",
      result: JSON.stringify(result),
      finished_at: at(finishedAt),
    })
  );
}

/** A `done` history check that ended at `finishedAt` with `outcome` (default `fail`) for the listed categories. */
export const addFailedCheck = (
  conn: Db,
  box: TripBox,
  finishedAt: string,
  categories: Grant["category"][],
  outcome: "fail" | "pass" | "inconclusive" = "fail"
): Promise<void> =>
  addCheck(conn, box, finishedAt, Object.fromEntries(categories.map((category) => [category, outcome])));

export const tripsOf = (conn: Db, box: TripBox) =>
  conn
    .selectFrom("autonomy_trips")
    .select(["id", "category", "reason", "granted_at", "counts", "cleared_at"])
    .where("mailbox_id", "=", box.mailboxId)
    .orderBy("category")
    .orderBy("tripped_at")
    .execute();

export const pausedNotices = (conn: Db, box: TripBox) =>
  conn
    .selectFrom("outbox")
    .select(["user_id", "dedup_key", "locale", "view", "channel"])
    .where("org_id", "=", box.orgId)
    .where("kind", "=", "autonomy_paused")
    .orderBy("user_id")
    .orderBy("dedup_key")
    .execute();

/** The stored `auto` and grant time per category. */
export async function policyOf(conn: Db, box: TripBox) {
  const row = await conn
    .selectFrom("mailbox_settings")
    .select("category_policy")
    .where("mailbox_id", "=", box.mailboxId)
    .executeTakeFirstOrThrow();
  return row.category_policy as Record<string, { auto?: boolean; grant?: { at?: string; by?: string } }>;
}

export async function tripAudit(conn: Db, box: TripBox) {
  const { rows } = await sql<{ data: Record<string, unknown>; actor: string }>`
    select data, actor from audit_log
    where org_id = ${box.orgId} and event = 'mailbox.policy_changed' and data->>'reason' = 'tripwire'
    order by created_at, id`.execute(conn);
  return rows;
}
