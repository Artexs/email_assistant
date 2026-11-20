import { MINUTE_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { insertDefaultSettings } from "../../src/modules/config";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createLlmPause, createTriageJob, type TriageScope, noGateEvidence } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox } from "./fixtures";

export const now = new Date("2026-11-05T12:00:00.123Z");

export function minutesFromNow(minutes: number): Date {
  return new Date(now.getTime() + minutes * MINUTE_MS);
}

export interface FakeLlm extends LlmClient {
  prompts: string[];
  allowed: string[][];
}

export const probeCategories = ["urgent", "needs_reply", "info", "notification", "spam", "unsure", "delegation"];
export const infoAnswer = {
  category: "info",
  confidence: 0.9,
  reason_code: "newsletter",
  reason: "a newsletter",
  summary: "short summary",
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
};

export function fakeLlm(): FakeLlm {
  const prompts: string[] = [];
  const allowed: string[][] = [];
  return {
    modelOf: () => "fake-model",
    endpointOf: () => "standard",
    providerOf: () => "openai",
    prompts,
    allowed,
    async generate(req) {
      prompts.push(req.prompt);
      allowed.push(probeCategories.filter((category) => req.schema.safeParse({ ...infoAnswer, category }).success));
      return {
        data: req.schema.parse(infoAnswer),
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
  } as FakeLlm;
}

export function job(trx: Transaction<DB>, llm: LlmClient, scope: TriageScope, at: Date = now) {
  return createTriageJob({
    runningKey: noGateEvidence.runningKey,
    db: trx,
    llm,
    pause: createLlmPause(),
    scope,
    batchSize: 5,
    testMail: NO_TEST_SENDERS,
    dailyCap: 1000,
    junkDailyCap: 1000,
    now: () => at,
  });
}

export async function mailboxWithSettings(trx: Transaction<DB>, opts?: { address?: string }) {
  const created = await createOrgWithMailbox(trx, opts);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  return { ...created, ctx };
}

export async function emailRow(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("emails").select(["status", "attempts"]).where("id", "=", id).executeTakeFirstOrThrow();
}
