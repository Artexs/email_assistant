import { createHash } from "node:crypto";

import { createLog } from "./log";

const log = createLog("pwned");

export type PwnedResult = "ok" | "pwned" | "unavailable";

export interface PwnedDeps {
  fetch: typeof fetch;
  timeoutMs: number;
}

export const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";

const LINE_BREAK = /\r?\n/;

// L14: the k-anonymity range API of Have I Been Pwned. Only 5 hex characters of the SHA-1 leave the server.
// Never rejects; a failure is "unavailable" and the caller fails closed.
// Never logs the password, the hash or the prefix.
export async function checkPwnedPassword(password: string, deps: PwnedDeps): Promise<PwnedResult> {
  try {
    const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const suffix = hash.slice(5);
    const response = await deps.fetch(`${PWNED_RANGE_URL}${hash.slice(0, 5)}`, {
      headers: { "Add-Padding": "true", "User-Agent": "email-assistant" },
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    if (response.status !== 200) {
      log.warn(`pwned check unavailable: status ${response.status}`);
      return "unavailable";
    }
    const body = await response.text();
    for (const line of body.split(LINE_BREAK)) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === undefined || count === undefined) continue;
      if (candidate.toUpperCase() !== suffix) continue;
      if (/^\d+$/.test(count) && Number(count) > 0) return "pwned";
    }
    return "ok";
  } catch (error) {
    const code = error instanceof Error ? error.name : "unknown";
    log.warn(`pwned check unavailable: ${code}`);
    return "unavailable";
  }
}
