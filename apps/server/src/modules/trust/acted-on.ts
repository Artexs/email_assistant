// "Acted on" (F110 D6): the user dealt with the mail themselves. The IMAP flag `\Answered` or `\Flagged`, or feedback whose true
// category is `urgent` or `needs_reply`. Sent-mail signals join here later (the seam of the next epic): this is the only reader of
// the definition, so a new signal changes one function.
import type { Db, TenantContext } from "../../platform/db";
import { listAnsweredOrFlagged } from "../mail";
import { listLatestFeedbackByEmailIds } from "../triage";

const IMPORTANT_TRUE_CATEGORIES: readonly string[] = ["urgent", "needs_reply"];

export async function historyActedOn(db: Db, ctx: TenantContext, emailIds: readonly string[]): Promise<Set<string>> {
  const acted = await listAnsweredOrFlagged(db, ctx, emailIds);
  const feedback = await listLatestFeedbackByEmailIds(db, ctx, emailIds);
  for (const [emailId, row] of feedback) {
    if (row.true_category !== null && IMPORTANT_TRUE_CATEGORIES.includes(row.true_category)) acted.add(emailId);
  }
  return acted;
}
