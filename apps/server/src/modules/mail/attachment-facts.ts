import { attachmentFact, type AttachmentFact } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { isFeatureOn } from "../tenancy";

import { listAttachmentInputs } from "./repo";

// The attachment fact of each mail that a notice shows (F109 stage 06, flag `attachment_line`): empty while the flag is off.
// A mail with no `email_headers` row, no attachment, or only inline and calendar parts is absent. Names and sizes only.
export async function attachmentFactsToShow(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, AttachmentFact>> {
  const facts = new Map<string, AttachmentFact>();
  if (emailIds.length === 0 || !(await isFeatureOn(db, ctx, "attachment_line"))) return facts;
  for (const [emailId, input] of await listAttachmentInputs(db, ctx, emailIds)) {
    const fact = attachmentFact(input);
    if (fact !== null) facts.set(emailId, fact);
  }
  return facts;
}
