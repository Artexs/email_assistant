import { createHash } from "node:crypto";

import { errorFields } from "./errors";
import { createLog } from "./log";

const log = createLog("pwned");

export type PwnedResult = "ok" | "pwned" | "unavailable";

export interface PwnedDeps {
  fetch: typeof fetch;
  timeoutMs: number;
}

export const PWNED_RANGE_URL = "https://api.pwnedpasswords.com/range/";

const LINE_BREAK = /\r?\n/;
// A real answer holds SUFFIX:COUNT lines (the SHA-1 suffix has 35 hex characters).
const RANGE_LINE = /^[0-9A-F]{35}:\d+$/;

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
      log.warn("pwned_check_unavailable", { status: response.status });
      return "unavailable";
    }
    const body = await response.text();
    let valid = 0;
    let listed = false;
    for (const line of body.split(LINE_BREAK)) {
      const entry = line.trim().toUpperCase();
      if (!RANGE_LINE.test(entry)) continue;
      valid += 1;
      const [candidate, count] = entry.split(":");
      if (candidate === suffix && Number(count) > 0) listed = true;
    }
    // A 200 page without one valid line (a captive portal, a proxy error page) proves nothing: fail closed.
    if (valid === 0) {
      log.warn("pwned_check_unavailable", { reason: "no_range_lines" });
      return "unavailable";
    }
    return listed ? "pwned" : "ok";
  } catch (error) {
    log.warn("pwned_check_unavailable", { ...errorFields(error) });
    return "unavailable";
  }
}
