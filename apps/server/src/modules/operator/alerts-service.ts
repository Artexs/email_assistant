import { DAY_MS, SLO_KINDS, type SloKind } from "@ea/core";

import type { Db } from "../../platform/db";

import { listAlerts, type OpsAlertRow } from "./alerts-repo";
import { sloAlertText, TEST_FACTS, TEST_IDS, type AlertLocale } from "./slo-texts";

// The two service functions of the CLIs `ops:alerts` and `ops:alert-test`.

const LIST_LIMIT = 200;

/** The incidents opened in the last `days` days, newest first. Numbers and kinds only. */
export async function recentAlerts(db: Db, input: { days: number; now: Date }): Promise<OpsAlertRow[]> {
  return listAlerts(db, { since: new Date(input.now.getTime() - input.days * DAY_MS), limit: LIST_LIMIT });
}

export interface TestAlertResult {
  kind: SloKind;
  outcome: "sent" | "no_chat";
}

/**
 * Sends the `test` text of each kind with fixed facts through the same send as the job. It writes no `ops_alerts` row.
 * `send` null (no operator chat) gives `no_chat`. `report` gets each result as it happens. A send error stops the run and
 * reaches the caller, so the results reported before it are the kinds that went out.
 */
export async function sendTestAlerts(input: {
  kinds: readonly SloKind[];
  send: ((text: string) => Promise<void>) | null;
  now: Date;
  locale?: AlertLocale;
  report?: (result: TestAlertResult) => void;
}): Promise<TestAlertResult[]> {
  const results: TestAlertResult[] = [];
  const add = (result: TestAlertResult): void => {
    results.push(result);
    input.report?.(result);
  };
  for (const kind of SLO_KINDS.filter((candidate) => input.kinds.includes(candidate))) {
    if (input.send === null) {
      add({ kind, outcome: "no_chat" });
      continue;
    }
    const text = sloAlertText({
      kind,
      phase: "test",
      facts: TEST_FACTS[kind],
      ids: TEST_IDS[kind],
      openedAt: input.now,
      now: input.now,
      locale: input.locale,
    });
    await input.send(text);
    add({ kind, outcome: "sent" });
  }
  return results;
}
