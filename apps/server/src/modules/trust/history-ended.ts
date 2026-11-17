// What a check that ends tells the owner (F110 D16): the first check of a mailbox that ends `done` or `no_result` queues the
// `trust_report_ready` notice, in the transaction of the end. Later checks queue nothing. The view holds counts and category names only.
import { movingCategories, type GateEvidenceDeps, type MovingCategory } from "@ea/core";

import { queueTrustNotice, trustReportUrlOf } from "../channels";
import type { TestMailRule } from "../mail";
import { isFeatureOn } from "../tenancy";

import { readCategoryEvidence } from "./gate";
import { listItems } from "./history-items";
import type { EndedHook } from "./history-queue";
import { countEarlierEndedChecks } from "./repo";

export interface EndedDeps {
  gate: GateEvidenceDeps;
  testMail: TestMailRule;
  /** `WEB_BASE_URL`: the report link of the notice; absent: the text has no link. */
  webBaseUrl?: string;
  now(): Date;
}

export function reportNoticeOnEnd(deps: EndedDeps): EndedHook {
  return async (trx, ctx, ended) => {
    if (ended.reason === "key_changed") return;
    if (!(await isFeatureOn(trx, ctx, "trust_ladder"))) return;
    if ((await countEarlierEndedChecks(trx, ctx, ended.mailboxId, ended.checkId)) > 0) return;
    const now = deps.now();
    const recommended: MovingCategory[] = [];
    for (const category of movingCategories) {
      const { result } = await readCategoryEvidence(trx, ctx, ended.mailboxId, category, {
        gate: deps.gate,
        testMail: deps.testMail,
        now,
      });
      if (result.recommended) recommended.push(category);
    }
    const items = await listItems(trx, ctx, ended.checkId);
    await queueTrustNotice(trx, ctx, {
      kind: "trust_report_ready",
      mailboxId: ended.mailboxId,
      now,
      view: {
        mailboxId: ended.mailboxId,
        recommended,
        blocked: movingCategories.length - recommended.length,
        checked: items.length,
        reportUrl: trustReportUrlOf(deps.webBaseUrl, ended.mailboxId),
      },
    });
  };
}
