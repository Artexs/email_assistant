import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

import { auditEvents, listAuditEvents } from "./repo";

// A soft pause starts at 5 min (triage/pause.ts); a config pause doubles up to 60 min and a spent quota stays spent.
export const SOFT_PAUSE_MAX_AGE_MS = 10 * 60_000;
export const CONFIG_PAUSE_MAX_AGE_MS = 2 * 3_600_000;
const ROW_LIMIT = 200;

type DbOrTrx = Db | Transaction<DB>;

export interface LlmPauseRead {
  code: string;
  since: Date;
}

/**
 * The LLM pause of the organization, read from the `llm.call` audit rows (so a restart does not clear it).
 * The newest row decides: a pause when its `reason_code` is a soft code and the row is at most 10 min old,
 * or a config code and the row is at most 2 h old. `since` is the oldest row of the unbroken run of pause-code
 * rows before it (an `ok` row or another code ends the run). Else null. Reads at most 200 rows of the last 2 h.
 * The code lists come from the caller: `audit` does not import the LLM platform code.
 */
export async function latestLlmPause(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { now: Date; softCodes: readonly string[]; configCodes: readonly string[] }
): Promise<LlmPauseRead | null> {
  const rows = await listAuditEvents(db, ctx, {
    events: [auditEvents.llmCall],
    since: new Date(opts.now.getTime() - CONFIG_PAUSE_MAX_AGE_MS),
    limit: ROW_LIMIT,
  });
  const newest = rows[0];
  if (newest === undefined || newest.reasonCode === null) return null;
  const maxAge = opts.softCodes.includes(newest.reasonCode)
    ? SOFT_PAUSE_MAX_AGE_MS
    : opts.configCodes.includes(newest.reasonCode)
      ? CONFIG_PAUSE_MAX_AGE_MS
      : null;
  if (maxAge === null || opts.now.getTime() - newest.at.getTime() > maxAge) return null;

  let since = newest.at;
  for (const row of rows) {
    if (
      row.reasonCode === null ||
      !(opts.softCodes.includes(row.reasonCode) || opts.configCodes.includes(row.reasonCode))
    )
      break;
    since = row.at;
  }
  return { code: newest.reasonCode, since };
}
