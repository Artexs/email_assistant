import type { Transaction } from "kysely";

import type { ApprovalHooks } from "../../src/modules/actions";
import { delegationHooks } from "../../src/modules/delegation";
import { createReplySweep } from "../../src/modules/replies";
import type { DB } from "../../src/platform/db";

import { SWEEP_NOW, type SweepOrg } from "./reply-answered-fixtures";

export const NOW = SWEEP_NOW;

export async function send(trx: Transaction<DB>, id: string) {
  return trx.selectFrom("actions").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export function sweepOf(
  trx: Transaction<DB>,
  decided: { sendId: string; decision: string }[] = [],
  limits: { closeLimit?: number; listLimit?: number; now?: () => Date } = {}
) {
  const approvalHooks: ApprovalHooks = {
    onDecided: async (_trx, _ctx, input) => {
      decided.push({ sendId: input.sendId, decision: input.decision });
    },
  };
  return createReplySweep({
    db: trx,
    hooks: delegationHooks({ db: trx }),
    approvalHooks,
    uidplus: async () => true,
    now: limits.now ?? (() => NOW),
    ...(limits.closeLimit === undefined ? {} : { closeLimit: limits.closeLimit }),
    ...(limits.listLimit === undefined ? {} : { listLimit: limits.listLimit }),
  });
}

export const run = (trx: Transaction<DB>, o: SweepOrg, decided?: { sendId: string; decision: string }[]) =>
  sweepOf(trx, decided).run({ mailboxIds: [o.mailboxId] });
