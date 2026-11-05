import {
  actionStatusFor,
  autoFor,
  decidePolicy,
  planActions,
  type Category,
  type CategoryPolicy,
  type MailboxMode,
  type PlannedAction,
  type SenderRule,
  type ToolSwitches,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import type { LlmUsage } from "../../platform/llm";
import { createLog } from "../../platform/log";
import { createPlanned, type PlannedActionInput } from "../actions";
import { auditEvents, recordAudit } from "../audit";
import { finishEmail, type ClaimedEmail } from "../mail";

import { insertTriageResult } from "./repo";

const log = createLog("triage");

export interface TriageMailbox {
  id: string;
  mode: MailboxMode;
  toolSwitches: ToolSwitches;
  policy: CategoryPolicy;
  rules: readonly SenderRule[];
  movesSupported: boolean;
}

export interface TriageDecision {
  finalCategory: Category;
  modelCategory: Category | null;
  confidence: number;
  // The model's code goes to `triage_results.reason_code`; the threshold never changes it.
  reasonCode: string;
  reason: string | null;
  summary: string | null;
  fields: Record<string, unknown>;
  vip: boolean;
  model: string | null;
  promptVersion: string | null;
  usage: LlmUsage | null;
  // The code of the `email.triaged` audit row.
  auditReasonCode: string;
}

function payloadOf(action: PlannedAction): Record<string, string> {
  switch (action.type) {
    case "move":
      return { folder: action.folder };
    case "save_summary":
      return { summary: action.summary };
    default:
      return {};
  }
}

// One transaction: the email status, the result, the actions and the audit rows.
// A lost claim (another run took the mail) returns `lost` and writes nothing; it does not throw.
export async function saveTriage(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailbox: TriageMailbox,
  email: ClaimedEmail,
  decision: TriageDecision
): Promise<{ kind: "triaged" } | { kind: "lost" }> {
  const categoryAuto = autoFor(mailbox.policy, decision.finalCategory);
  const items: PlannedActionInput[] = planActions(decision.finalCategory, decision.summary).map((action) => ({
    type: action.type,
    payload: payloadOf(action),
    status: actionStatusFor(
      decidePolicy(action, {
        mode: mailbox.mode,
        toolSwitches: mailbox.toolSwitches,
        category: decision.finalCategory,
        categoryAuto,
        vip: decision.vip,
        movesSupported: mailbox.movesSupported,
      })
    ),
    idempotencyKey: `${email.id}:${action.type}`,
  }));

  const run = async (trx: Transaction<DB>): Promise<{ kind: "triaged" } | { kind: "lost" }> => {
    if (!(await finishEmail(trx, ctx, email.id, email.locked_at, { status: "triaged" }))) {
      log.warn(`triage ${email.id}: lost the claim`);
      return { kind: "lost" };
    }
    await insertTriageResult(trx, ctx, {
      emailId: email.id,
      category: decision.finalCategory,
      vip: decision.vip,
      confidence: decision.confidence,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      fields:
        decision.modelCategory === null
          ? decision.fields
          : { ...decision.fields, model_category: decision.modelCategory },
      model: decision.model,
      promptVersion: decision.promptVersion,
      tokensIn: decision.usage?.tokensIn ?? null,
      tokensOut: decision.usage?.tokensOut ?? null,
      latencyMs: decision.usage?.latencyMs ?? null,
    });
    const created = await createPlanned(trx, ctx, email.id, items);
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actor: "system",
      event: auditEvents.emailTriaged,
      reasonCode: decision.auditReasonCode,
      data: {
        mailbox_id: mailbox.id,
        final_category: decision.finalCategory,
        model_category: decision.modelCategory,
        confidence: decision.confidence,
        prompt_version: decision.promptVersion,
        model: decision.model,
      },
    });
    for (const action of created) {
      await recordAudit(trx, ctx, {
        emailId: email.id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionPlanned,
        data: { action_type: action.type, status: action.status },
      });
    }
    return { kind: "triaged" };
  };

  const result = await (db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run));
  if (result.kind === "triaged") {
    log.info(
      `triage ${email.id}: mailbox ${mailbox.id} category ${decision.finalCategory} code ${decision.auditReasonCode}`
    );
  }
  return result;
}
