import { trustViewSchema, type TrustView } from "@ea/core/web";

import { api, ApiError } from "./api";

export function trustPath(mailboxId: string): string {
  return `/api/trust/${encodeURIComponent(mailboxId)}`;
}

// The page of the report of one mailbox (F110 stage 14).
export function reportPath(mailboxId: string): string {
  return `/report?mailbox=${encodeURIComponent(mailboxId)}`;
}

// `null`: the flag `trust_ladder` is off (the route answers like for an unknown path), or the mailbox is gone, or the view did not load.
// The card then shows no evidence lines and reads `auto` from the settings, as it did before F110. Another error is not hidden from
// the logs of the browser, but it must not break the Settings page.
export async function loadTrustView(mailboxId: string): Promise<TrustView | null> {
  try {
    return await api(trustPath(mailboxId), trustViewSchema);
  } catch (error) {
    if (error instanceof ApiError) return null;
    throw error;
  }
}
