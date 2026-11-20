// Shared code of the trust-regate test files: the evidence keys, the gate files, the setup of an organization with a policy and the readers of its rows (ADR 0028).

import {
  barCategories,
  type BarCategory,
  type EvidenceKey,
  type GateEvidenceDeps,
  type GateIndexFile,
  type GlobalEvidence,
} from "@ea/core";
import { type Transaction } from "kysely";

import { settingsDeps } from "../../src/composition";
import { listActionsForEmail } from "../../src/modules/actions";
import { insertDefaultSettings, setMode } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { setOrgFeature } from "../../src/modules/tenancy";
import { createLlmPause, createTriageJob } from "../../src/modules/triage";
import { type RegateDeps } from "../../src/modules/trust";
import type { DB, Db } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { addMember, createOrgWithMailbox, linkChat, pauseOtherMailboxes, randomChatId } from "./fixtures";

export const NOW = new Date("2026-11-16T12:00:00.000Z");
export const GRANT_AT = "2026-11-01T10:00:00.000Z";

export const KEY_A: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};
export const KEY_B: EvidenceKey = { ...KEY_A, model: "gemini-4" };
export const KEY_A_EU: EvidenceKey = { ...KEY_A, endpoint: "eu" };

export const NO_EVIDENCE: GlobalEvidence = {
  decision: "none",
  provisional: false,
  precision: null,
  wilsonLower: null,
  threshold: null,
  cases: 0,
  file: null,
};

// A gate file for `key`: `go` for the listed categories, `no-go` for the rest. `decision: "no-go"` makes every category `no-go`.
export function gateFile(
  key: EvidenceKey,
  opts: { go?: BarCategory[]; provisional?: boolean; date?: string; file?: string; noGo?: boolean } = {}
): GateIndexFile {
  const provisional = opts.provisional ?? false;
  const file = opts.file ?? "classifier-fixture.json";
  const go = opts.go ?? ["info", "notification", "spam"];
  const categories = {} as Record<BarCategory, GlobalEvidence>;
  for (const category of barCategories) {
    categories[category] =
      go.includes(category) && opts.noGo !== true
        ? { decision: "go", provisional, precision: 0.99, wilsonLower: 0.97, threshold: 0.8, cases: 200, file }
        : { ...NO_EVIDENCE, decision: "no-go", provisional, file };
  }
  return { key, file, date: opts.date ?? "2026-11-01", provisional, categories };
}

export const gateOf = (runningKey: EvidenceKey, ...files: GateIndexFile[]): GateEvidenceDeps => ({
  index: { files },
  runningKey,
});

export function depsOf(conn: Db | Transaction<DB>, gate: GateEvidenceDeps, over: Partial<RegateDeps> = {}): RegateDeps {
  return {
    db: conn,
    gate,
    testMail: NO_TEST_SENDERS,
    settingsOf: (trx) => settingsDeps(trx, () => NOW, gate),
    webBaseUrl: "https://app.example.test",
    run: "job",
    ...over,
  };
}

export interface Entry {
  auto: boolean;
  threshold: number;
  grant?: { key: EvidenceKey; by: string; at: string };
}
export const on = (key: EvidenceKey | null, by = "evidence"): Entry => ({
  auto: true,
  threshold: 0.7,
  ...(key === null ? {} : { grant: { key, by, at: GRANT_AT } }),
});

// An org with two linked owners and a mailbox in `assist` whose policy is `policy`; `flag` is `trust_ladder`.
export async function setup(
  trx: Transaction<DB>,
  policy: Partial<Record<BarCategory, Entry>>,
  opts: { flag?: boolean; committed?: boolean } = {}
) {
  // A committed box must not pause the mailboxes of other rows of the database.
  if (opts.committed !== true) await pauseOtherMailboxes(trx);
  const box = await createOrgWithMailbox(trx);
  const ctx = { orgId: box.orgId };
  await insertDefaultSettings(trx, ctx, box.mailboxId);
  await setMode(
    settingsDeps(trx, () => NOW),
    ctx,
    box.mailboxId,
    { mode: "assist", keepSwitches: false, actor: "test" }
  );
  await trx
    .updateTable("mailbox_settings")
    .set({ category_policy: JSON.stringify(policy) })
    .where("mailbox_id", "=", box.mailboxId)
    .execute();
  const owner2 = await addMember(trx, box.orgId, "owner");
  for (const userId of [box.userId, owner2]) await linkChat(trx, ctx, userId, randomChatId(), NOW);
  if (opts.flag !== false) {
    await setOrgFeature(trx, ctx, { flag: "trust_ladder", enabled: true, actor: box.userId, now: NOW });
  }
  return { ...box, ctx, owner2 };
}

export type Box = Awaited<ReturnType<typeof setup>>;

export async function policyOf(conn: Db | Transaction<DB>, mailboxId: string) {
  const row = await conn
    .selectFrom("mailbox_settings")
    .select("category_policy")
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirstOrThrow();
  return row.category_policy as Record<string, Entry | undefined>;
}

export const tripsOf = (conn: Db | Transaction<DB>, mailboxId: string) =>
  conn.selectFrom("autonomy_trips").selectAll().where("mailbox_id", "=", mailboxId).orderBy("category").execute();

export const noticesOf = (conn: Db | Transaction<DB>, orgId: string) =>
  conn
    .selectFrom("outbox")
    .select(["user_id", "kind", "dedup_key", "view"])
    .where("org_id", "=", orgId)
    .where("kind", "=", "autonomy_paused")
    .orderBy("user_id")
    .execute();

export const checksOf = (conn: Db | Transaction<DB>, mailboxId: string) =>
  conn.selectFrom("history_checks").selectAll().where("mailbox_id", "=", mailboxId).execute();

export const policyAudit = (conn: Db | Transaction<DB>, orgId: string) =>
  conn
    .selectFrom("audit_log")
    .select(["actor", "data"])
    .where("org_id", "=", orgId)
    .where("event", "=", "mailbox.policy_changed")
    .orderBy("id")
    .execute();

export const notificationAnswer = {
  category: "notification",
  confidence: 0.95,
  reason_code: "automated_system",
  reason: "a notice",
  summary: null,
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
};

// A model client with a fixed answer; `beforeAnswer` runs when a call starts (the settings were read before it).
export function llmOf(beforeAnswer?: () => Promise<void>): LlmClient {
  return {
    modelOf: () => "fake-model",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    async generate(req) {
      await beforeAnswer?.();
      return {
        data: req.schema.parse(notificationAnswer),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: "fake-model",
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 300,
          endpoint: "standard",
          provider: "openai" as const,
        },
      };
    },
  } as LlmClient;
}

export function triageOf(conn: Db | Transaction<DB>, runningKey: EvidenceKey, llm: LlmClient) {
  return createTriageJob({
    runningKey,
    db: conn as Db,
    llm,
    pause: createLlmPause(),
    scope: { kind: "all" },
    batchSize: 5,
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    now: () => NOW,
  });
}

export async function moveOf(conn: Db | Transaction<DB>, box: { orgId: string }, emailId: string) {
  const actions = await listActionsForEmail(conn, { orgId: box.orgId }, emailId);
  return actions.find((action) => action.type === "move");
}
