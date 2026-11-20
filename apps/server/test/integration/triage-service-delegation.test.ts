import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { listActionsForEmail } from "../../src/modules/actions";
import { triageOne } from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { testDb, withRollback } from "./helpers";
import {
  results,
  audit,
  fakeLlm,
  analysis,
  setupMail,
  llmRows,
  delegationSetup,
  delegationAnswer,
  triageDeps,
  delegationRows,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const OFFER_DAY = new Date("2026-11-10T16:00:00Z");

async function dependsOn(trx: Transaction<DB>, actionId: string | undefined) {
  const row = await trx
    .selectFrom("actions")
    .select("depends_on_action_id")
    .where("id", "=", actionId ?? "")
    .executeTakeFirstOrThrow();
  return row.depends_on_action_id;
}

describe("triageOne: the delegation plan", () => {
  test("a delegation mail gets a ready draft, a send, a delegations row and delegation_id in both payloads", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx);
      const llm = fakeLlm(delegationAnswer(delegateId));
      expect(await triageOne(triageDeps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "triaged" });

      const actions = await listActionsForEmail(trx, ctx, emailId);
      const draft = actions.find((a) => a.type === "create_draft");
      const send = actions.find((a) => a.type === "send");
      expect(actions).toHaveLength(2);
      const [delegation] = await delegationRows(trx, emailId);
      expect(delegation).toMatchObject({
        status: "drafted",
        delegate_id: delegateId,
        task_summary: "Prepare the offer",
        draft_action_id: draft?.id,
        send_action_id: send?.id,
      });
      expect(delegation?.due_at).toEqual(OFFER_DAY);
      expect(draft).toMatchObject({ status: "ready" });
      expect(draft?.payload).toEqual({
        kind: "delegation",
        delegate_id: delegateId,
        delegate_name: "Anna",
        to: ["anna@firma.test"],
        task: "Prepare the offer",
        due_date: "2026-11-10",
        language: "en",
        delegation_id: delegation?.id,
      });
      expect(send).toMatchObject({ status: "awaiting_approval" });
      expect(await dependsOn(trx, send?.id)).toBe(draft?.id ?? null);
      expect(send?.payload).toEqual({
        kind: "delegation",
        to: ["anna@firma.test"],
        delegate_id: delegateId,
        delegation_id: delegation?.id,
      });

      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "delegation.created")).toHaveLength(1);
      expect(log.find((r) => r.event === "email.triaged")?.data).toMatchObject({ delegation_id: delegation?.id });
    });
  });

  test("shadow mode logs both rows and creates no delegations row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx, { mode: "shadow" });
      await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(delegateId))), ctx, mailbox, email);

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["create_draft", "logged"],
        ["send", "logged"],
      ]);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
      expect(JSON.stringify(actions.map((a) => a.payload))).not.toContain("delegation_id");
      const log = await audit(trx, emailId);
      expect(log.filter((r) => r.event === "delegation.created")).toHaveLength(0);
      expect(log.find((r) => r.event === "email.triaged")?.data).not.toHaveProperty("delegation_id");
    });
  });

  test("assist with the create_draft switch off logs both rows and creates no delegations row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx, { createDraft: false });
      await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(delegateId))), ctx, mailbox, email);

      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.status]).sort()).toEqual([
        ["create_draft", "logged"],
        ["send", "logged"],
      ]);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a clarification answer gives the pair to the sender and no delegations row", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await delegationSetup(trx);
      const answer = delegationAnswer(null, {
        fields: {
          due_date: null,
          language: "en",
          delegate_id: null,
          task: null,
          clarification: "Who should do this?",
        },
      });
      await triageOne(triageDeps(trx, fakeLlm(answer)), ctx, mailbox, email);

      const actions = await listActionsForEmail(trx, ctx, emailId);
      const draft = actions.find((a) => a.type === "create_draft");
      const send = actions.find((a) => a.type === "send");
      expect(draft?.payload).toMatchObject({ kind: "clarification", to: ["jan@klient.test"] });
      expect(send?.payload).toMatchObject({ kind: "clarification", to: ["jan@klient.test"] });
      expect(JSON.stringify([draft?.payload, send?.payload])).not.toContain("delegation_id");
      expect(await dependsOn(trx, send?.id)).toBe(draft?.id ?? null);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a delegation below the threshold plans the unsure move and no draft", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox, delegateId } = await delegationSetup(trx);
      await triageOne(triageDeps(trx, fakeLlm(delegationAnswer(delegateId, { confidence: 0.3 }))), ctx, mailbox, email);

      const [row] = await results(trx, emailId);
      expect(row?.category).toBe("unsure");
      const actions = await listActionsForEmail(trx, ctx, emailId);
      expect(actions.map((a) => [a.type, a.payload])).toEqual([["move", { folder: "ai_manual" }]]);
      expect(await delegationRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("the classifier gets 6 categories and the delegates with delegates, 5 without", async () => {
    await withRollback(db, async (trx) => {
      const seen: { categories: string[]; delegates: boolean }[] = [];
      const recording: LlmClient = {
        modelOf: () => "fake-model",
        endpointOf: () => "standard",
        providerOf: () => "openai",
        async generate(req) {
          const shape = (req.schema as unknown as { shape: { category: { options: string[] } } }).shape;
          seen.push({ categories: shape.category.options, delegates: req.prompt.includes("Anna") });
          return {
            data: req.schema.parse(analysis()()),
            usage: {
              role: req.role,
              promptVersion: req.promptVersion,
              model: "fake-model",
              tokensIn: 1,
              tokensOut: 1,
              latencyMs: 1,
              endpoint: "standard",
              provider: "openai" as const,
            },
          };
        },
      } as LlmClient;
      const withDelegates = await delegationSetup(trx);
      await triageOne(triageDeps(trx, recording), withDelegates.ctx, withDelegates.mailbox, withDelegates.email);
      const without = await setupMail(trx);
      await triageOne(triageDeps(trx, recording), without.ctx, without.mailbox, without.email);

      expect(seen.map((s) => s.categories.length)).toEqual([6, 5]);
      expect(seen[0]?.categories).toContain("delegation");
      expect(seen[1]?.categories).not.toContain("delegation");
      expect(seen.map((s) => s.delegates)).toEqual([true, false]);
    });
  });

  // The escalation cascade (a second call by another role for a person's mail answered info, notification,
  // spam or unsure) was never in the worker. These are the answers it would have picked: each mail makes the same
  // calls as before the removal, exactly one, by the classifier role with the production prompt.
  test("a person's mail that the removed cascade would have picked still makes one classifier call", async () => {
    const picked = [
      { category: "info", reason_code: "newsletter" },
      { category: "notification", reason_code: "automated_system" },
      { category: "spam", reason_code: "marketing" },
      { category: "info", reason_code: "newsletter", confidence: 0.3 },
    ];
    for (const overrides of picked) {
      await withRollback(db, async (trx) => {
        const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "anna@person.test" });
        const calls: { role: string; promptVersion: string }[] = [];
        const recording = {
          modelOf: () => "fake-model",
          endpointOf: () => "standard",
          providerOf: () => "openai",
          async generate(req) {
            calls.push({ role: req.role, promptVersion: req.promptVersion });
            return {
              data: req.schema.parse(analysis(overrides)()),
              usage: {
                role: req.role,
                promptVersion: req.promptVersion,
                model: "fake-model",
                tokensIn: 1,
                tokensOut: 1,
                latencyMs: 1,
                endpoint: "standard",
                provider: "openai" as const,
              },
            };
          },
        } as LlmClient;

        expect(await triageOne(triageDeps(trx, recording), ctx, mailbox, email)).toEqual({ kind: "triaged" });

        expect(calls).toEqual([{ role: "classifier", promptVersion: "classifier-v2" }]);
        const rows = await llmRows(trx, emailId);
        expect(rows.map((r) => r.data)).toMatchObject([{ role: "classifier", prompt_version: "classifier-v2" }]);
      });
    }
  });
});
