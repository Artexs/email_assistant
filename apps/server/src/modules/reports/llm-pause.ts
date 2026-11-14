import type { LlmPause } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { configCodes, softCodes } from "../../platform/llm";
import { latestLlmPause } from "../audit";
import { isFeatureOn } from "../tenancy";

type DbOrTrx = Db | Transaction<DB>;

/** The LLM pause for `/status` and the digest: null while the flag `llm_pause_line` is off, or when no pause shows in the audit rows. */
export async function llmPauseToShow(db: DbOrTrx, ctx: TenantContext, now: Date): Promise<LlmPause | null> {
  if (!(await isFeatureOn(db, ctx, "llm_pause_line"))) return null;
  return latestLlmPause(db, ctx, { now, softCodes, configCodes });
}
