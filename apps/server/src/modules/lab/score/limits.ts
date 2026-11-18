import { sendLimitKinds, type SendLimitKind } from "@ea/core";

import type { Db, TenantContext } from "../../../platform/db";
import { listSendLimitHolds } from "../../actions";
import { auditEvents, countEventsByDataKey } from "../../audit";

import { section } from "./render-util";
import type { SectionScope } from "./section";

export interface LimitsSection {
  // `action.send_limited` audit rows of the run mailbox in the run window, by limit kind.
  hits: Record<SendLimitKind, number>;
  total: number;
  // Sends of the run mailbox that wait on a send limit when the report is scored.
  heldAtEnd: number;
}

const LABEL: Record<SendLimitKind, string> = {
  mailbox_hour: "mailbox hour",
  mailbox_day: "mailbox day",
  recipient_day: "recipient day",
};

/** Pure: the counts by limit kind (a key that is no kind counts nowhere). */
export function scoreLimits(counts: ReadonlyMap<string, number>, heldAtEnd: number): LimitsSection {
  const hits = Object.fromEntries(sendLimitKinds.map((kind) => [kind, counts.get(kind) ?? 0])) as Record<
    SendLimitKind,
    number
  >;
  return { hits, total: sendLimitKinds.reduce((sum, kind) => sum + hits[kind], 0), heldAtEnd };
}

/** Reads the limit hits and the held sends of the run mailbox; every read filters by `ctx.orgId`. */
export async function scoreLimitsSection(db: Db, ctx: TenantContext, scope: SectionScope): Promise<LimitsSection> {
  const counts = await countEventsByDataKey(db, ctx, {
    event: auditEvents.actionSendLimited,
    key: "limit",
    range: scope.window,
    mailboxId: scope.mailboxId,
  });
  const holds = (await listSendLimitHolds(db, ctx, scope.now)).filter((hold) => hold.mailboxId === scope.mailboxId);
  return scoreLimits(
    counts,
    holds.reduce((sum, hold) => sum + hold.waiting, 0)
  );
}

export const renderLimits = section<LimitsSection>((data) => [
  "## Send limits",
  "",
  data.total === 0
    ? "Send limit hits: no send limit reached."
    : `Send limit hits ${data.total}: ${sendLimitKinds.map((kind) => `${LABEL[kind]} ${data.hits[kind]}`).join(", ")}.`,
  `Sends held by a limit when the report was scored: ${data.heldAtEnd}.`,
  "",
]);
