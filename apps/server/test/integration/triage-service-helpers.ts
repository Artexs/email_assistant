import { MINUTE_MS } from "@ea/core";
import type { LlmEndpointKind } from "@ea/core";
import type { Transaction } from "kysely";

import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { claimEmails } from "../../src/modules/mail";
import { NO_TEST_SENDERS, type TestMailRule } from "../../src/modules/mail";
import { type LlmPause, type TriageDecision, type TriageMailbox, noGateEvidence } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, insertDelegate, insertTestEmail, noSuspiciousContext } from "./fixtures";

export const now = new Date("2026-11-05T12:00:00.123Z");

export async function setup(trx: Transaction<DB>) {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  const settings = await getMailboxSettings(trx, ctx, created.mailboxId);
  if (!settings) throw new Error("no settings");
  const emailId = await insertTestEmail(trx, ctx, created.mailboxId);
  const [email] = await claimEmails(trx, ctx, created.mailboxId, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * MINUTE_MS),
    syntheticOnly: false,
  });
  if (!email) throw new Error("claim failed");
  const mailbox: TriageMailbox = {
    id: created.mailboxId,
    settingsVersion: settings.version,
    mode: "shadow",
    toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
    runningKey: noGateEvidence.runningKey,
    policy: { info: { auto: true } },
    rules: [],
    movesSupported: true,
    delegates: [],
    timezone: "Europe/Warsaw",
    junkFolder: null,
    resumedAt: null,
    suspicious: noSuspiciousContext,
    urgencyProfile: null,
  };
  return { ctx, emailId, email, mailbox };
}

export function decision(overrides: Partial<TriageDecision> = {}): TriageDecision {
  return {
    finalCategory: "info",
    modelCategory: "info",
    confidence: 0.9,
    reasonCode: "newsletter",
    reason: "a newsletter",
    summary: "short summary",
    fields: { lang: "pl" },
    vip: false,
    model: "m",
    promptVersion: "classifier-v1",
    usage: {
      role: "classifier",
      promptVersion: "classifier-v1",
      model: "m",
      tokensIn: 120,
      tokensOut: 30,
      latencyMs: 850,
      endpoint: "standard",
      provider: "openai" as const,
    },
    auditReasonCode: "newsletter",
    delegation: null,
    suspiciousReasons: [],
    ...overrides,
  };
}

export async function results(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("triage_results")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export async function audit(trx: Transaction<DB>, emailId: string) {
  return trx
    .selectFrom("audit_log")
    .selectAll()
    .where("email_id", "=", emailId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export async function emailStatus(trx: Transaction<DB>, emailId: string): Promise<string> {
  const row = await trx.selectFrom("emails").select("status").where("id", "=", emailId).executeTakeFirstOrThrow();
  return row.status;
}

export interface FakeLlm extends LlmClient {
  requests: { system: string; prompt: string }[];
}

export function fakeLlm(answer: (() => unknown) | Error, endpoint: LlmEndpointKind = "standard"): FakeLlm {
  const requests: { system: string; prompt: string }[] = [];
  return {
    modelOf: () => "fake-model",
    endpointOf: () => endpoint,
    providerOf: () => "openai",
    requests,
    async generate(req) {
      requests.push({ system: req.system, prompt: req.prompt });
      if (answer instanceof Error) throw answer;
      return {
        data: req.schema.parse(answer()),
        usage: {
          role: req.role,
          promptVersion: req.promptVersion,
          model: "fake-model",
          tokensIn: 100,
          tokensOut: 20,
          latencyMs: 300,
          endpoint,
          provider: "openai" as const,
        },
      };
    },
  } as FakeLlm;
}

export const analysis =
  (overrides: Record<string, unknown> = {}) =>
  () => ({
    category: "info",
    confidence: 0.9,
    reason_code: "newsletter",
    reason: "a newsletter",
    summary: "short summary",
    fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
    ...overrides,
  });

export interface FakePause extends LlmPause {
  trips: { kind: string; code: string }[];
  resets: number;
}

export function fakePause(): FakePause {
  return {
    trips: [],
    resets: 0,
    trip(kind, code, at) {
      this.trips.push({ kind, code });
      return new Date(at.getTime() + 5 * MINUTE_MS);
    },
    isPaused: () => false,
    pausedUntil: () => null,
    pausedSince: () => null,
    reset() {
      this.resets += 1;
    },
  };
}

export async function setupMail(
  trx: Transaction<DB>,
  overrides: Parameters<typeof insertTestEmail>[3] = {},
  rules: TriageMailbox["rules"] = [],
  syntheticOnly: false | { testMail: TestMailRule } = false
) {
  const base = await setup(trx);
  const emailId = await insertTestEmail(trx, base.ctx, base.mailbox.id, overrides);
  const claimed = await claimEmails(trx, base.ctx, base.mailbox.id, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * MINUTE_MS),
    syntheticOnly,
  });
  const email = claimed.find((row) => row.id === emailId);
  if (!email) throw new Error("claim failed");
  return { ...base, emailId, email, mailbox: { ...base.mailbox, rules } };
}

export async function llmRows(trx: Transaction<DB>, emailId: string) {
  return (await audit(trx, emailId)).filter((r) => r.event === "llm.call");
}

export async function delegationSetup(
  trx: Transaction<DB>,
  opts: {
    mode?: TriageMailbox["mode"];
    createDraft?: boolean;
    rules?: TriageMailbox["rules"];
    mail?: Parameters<typeof insertTestEmail>[3];
  } = {}
) {
  const base = await setupMail(trx, { from_address: "jan@klient.test", ...opts.mail }, opts.rules ?? []);
  const delegateId = await insertDelegate(trx, base.ctx, { name: "Anna", email: "anna@firma.test", tags: ["offers"] });
  const mailbox: TriageMailbox = {
    ...base.mailbox,
    mode: opts.mode ?? "assist",
    toolSwitches: { ...base.mailbox.toolSwitches, create_draft: opts.createDraft ?? true },
    delegates: [{ id: delegateId, name: "Anna", email: "anna@firma.test", tags: ["offers"] }],
  };
  return { ...base, mailbox, delegateId };
}

export const delegationAnswer = (delegateId: string | null, overrides: Record<string, unknown> = {}) =>
  analysis({
    category: "delegation",
    confidence: 0.95,
    reason_code: "direct_request",
    summary: null,
    fields: {
      due_date: "2026-11-10",
      language: "en",
      delegate_id: delegateId,
      task: "Prepare the offer",
      clarification: null,
    },
    ...overrides,
  });

export function triageDeps(trx: Transaction<DB>, llm: LlmClient, clock: Date = now) {
  return {
    db: trx,
    llm,
    pause: fakePause(),
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    now: () => clock,
  };
}

export async function delegationRows(trx: Transaction<DB>, emailId: string) {
  return trx.selectFrom("delegations").selectAll().where("email_id", "=", emailId).execute();
}
