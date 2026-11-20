import { randomUUID } from "node:crypto";

import {
  barCategories,
  type BarCategory,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GateIndexFile,
  type GlobalEvidence,
  HOUR_MS,
} from "@ea/core";
import type { Hono } from "hono";

import { settingsDeps } from "../../src/composition";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { upsertOrgFeature } from "../../src/modules/tenancy";
import { trustRoutes } from "../../src/modules/trust";
import type { Db } from "../../src/platform/db";
import type { ApiEnv } from "../../src/platform/http";

import { insertTestEmail } from "./fixtures";
import { addMailbox, insertCheckItemRow, insertCheckRow, insertTripRow } from "./trust-fixtures";
import { webOrg, webTestApp, type WebOrg } from "./web-helpers";

// Committed rows for the trust routes: an organization with an owner and a member (role `assistant`), one mailbox
// each for it and for a second organization, the flag `trust_ladder`, a gate file for the running key and history checks.
export const NOW = new Date("2026-11-17T12:00:00Z");

export const KEY: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

const NO_EVIDENCE: GlobalEvidence = {
  decision: "none",
  provisional: false,
  precision: null,
  wilsonLower: null,
  threshold: null,
  cases: 0,
  file: null,
};

/** A gate file for `key`: `go` (with the threshold) for the listed categories, `no-go` for the others. */
export function gateFile(go: Partial<Record<BarCategory, number | null>>, key: EvidenceKey = KEY): GateIndexFile {
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    categories[category] =
      category in go
        ? {
            decision: "go",
            provisional: false,
            precision: 0.99,
            wilsonLower: 0.97,
            threshold: go[category] ?? null,
            cases: 200,
            file: "classifier-fixture.json",
          }
        : { ...NO_EVIDENCE, decision: "no-go", file: "classifier-fixture.json" };
  }
  return { key, file: "classifier-fixture.json", date: "2026-11-01", provisional: false, categories };
}

export const gateOf = (file: GateIndexFile, runningKey: EvidenceKey = KEY): GateEvidenceDeps => ({
  index: { files: [file] },
  runningKey,
});

export interface TrustWebBox {
  org: WebOrg;
  mailboxId: string;
  otherMailboxId: string;
  app(gate?: GateEvidenceDeps): Hono<ApiEnv>;
  cleanup(): Promise<void>;
}

export async function trustWebBox(db: Db, opts: { flag?: boolean } = {}): Promise<TrustWebBox> {
  const org = await webOrg(db);
  const mailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.orgId }));
  const otherMailboxId = await db.transaction().execute((trx) => addMailbox(trx, { orgId: org.otherOrgId }));
  for (const orgId of [org.orgId, org.otherOrgId]) {
    await upsertOrgFeature(
      db,
      { orgId },
      { flag: "trust_ladder", enabled: opts.flag ?? true, setBy: "test", setAt: NOW }
    );
  }
  return {
    org,
    mailboxId,
    otherMailboxId,
    app: (gate = gateOf(gateFile({ info: 0.8, notification: 0.9, spam: 0.95 }))) =>
      webTestApp({
        db,
        sessions: { owner: org.ownerId, member: org.assistantId, other: org.otherOwnerId },
        routers: (api) =>
          api.route("/", trustRoutes({ settings: settingsDeps(db, () => NOW, gate), testMail: NO_TEST_SENDERS })),
      }),
    cleanup: () => org.cleanup(),
  };
}

type Outcome = "pass" | "fail" | "inconclusive" | "no_result";

/** A `done` history check that finished at `finishedAt` with one outcome per moving category. Returns the check id. */
export async function addDoneCheck(
  db: Db,
  orgId: string,
  mailboxId: string,
  outcomes: Partial<Record<"info" | "notification" | "spam", Outcome>>,
  finishedAt: Date = new Date("2026-11-16T12:00:00Z")
): Promise<string> {
  const entry = { acted: 60, moved: 0, upper: 0.01, total: 200, wouldMove: 40 };
  const result = Object.fromEntries(
    Object.entries(outcomes).map(([category, outcome]) => [category, { ...entry, outcome }])
  );
  return db.transaction().execute((trx) =>
    insertCheckRow(trx, { orgId }, mailboxId, {
      status: "done",
      result: JSON.stringify(result),
      finished_at: finishedAt,
      created_at: new Date(finishedAt.getTime() - HOUR_MS),
    })
  );
}

export interface ExampleMail {
  category?: "info" | "notification" | "spam";
  receivedAt: string;
  fromName?: string | null;
  subject?: string | null;
  actedOn?: boolean;
  wouldMove?: boolean;
}

/** One mail with its item in the check. Returns the mail id. */
export async function addExample(
  db: Db,
  orgId: string,
  mailboxId: string,
  checkId: string,
  mail: ExampleMail
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const emailId = await insertTestEmail(trx, { orgId }, mailboxId, {
      received_at: new Date(mail.receivedAt),
      subject: mail.subject ?? null,
      status: "skipped",
    });
    if (mail.fromName !== undefined) {
      await trx
        .insertInto("email_headers")
        .values({
          email_id: emailId,
          org_id: orgId,
          from_name: mail.fromName,
          attachments: "[]",
          attachment_count: 0,
          parts_known: true,
          captured_at: new Date(),
        })
        .execute();
    }
    await insertCheckItemRow(trx, { orgId }, checkId, emailId, {
      category: mail.category ?? "info",
      acted_on: mail.actedOn ?? true,
      would_move: mail.wouldMove ?? true,
    });
    return emailId;
  });
}

export const addTrip = (db: Db, orgId: string, mailboxId: string, category: BarCategory) =>
  db
    .transaction()
    .execute((trx) =>
      insertTripRow(trx, { orgId }, mailboxId, { category, granted_at: new Date("2026-11-10T10:00:00Z") })
    );

export const newId = (): string => randomUUID();

export async function policyOf(db: Db, mailboxId: string) {
  const row = await db
    .selectFrom("mailbox_settings")
    .select(["mode", "tool_switches", "category_policy"])
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return {
    mode: row.mode,
    switches: row.tool_switches as Record<string, boolean>,
    policy: row.category_policy as Record<string, { auto?: boolean; threshold?: number; grant?: { by: string } }>,
  };
}

export const auditOf = (db: Db, orgId: string) =>
  db
    .selectFrom("audit_log")
    .select(["event", "data"])
    .where("org_id", "=", orgId)
    .where("event", "in", ["mailbox.policy_changed", "mailbox.mode_changed"])
    .orderBy("id")
    .execute();
