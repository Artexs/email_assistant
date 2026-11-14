import type { CoreTexts } from "../texts";

import { formatClock } from "./local-time";

/** An LLM pause that the audit rows show: the newest error code and the start of its run. */
export interface LlmPause {
  code: string;
  since: Date;
}

// The provider answered "the quota or the budget is spent": the owner can act on that, so the line says it in words.
const QUOTA_CODE = "http_429_quota";

/** One line for `/status` and the digest footer. The clock follows `formatClock` (a time of today, else a day and a time). */
export function llmPauseLine(pause: LlmPause, timeZone: string, now: Date, texts: CoreTexts): string {
  const since = formatClock(pause.since, timeZone, now, texts.locale);
  return pause.code === QUOTA_CODE
    ? texts.digest.llmPause.quota(since, pause.code)
    : texts.digest.llmPause.other(since, pause.code);
}
