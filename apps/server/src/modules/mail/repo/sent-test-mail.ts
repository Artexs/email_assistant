import { normalizeAddress } from "@ea/core";
import { sql, type Expression, type SqlBool } from "kysely";

import { normalizedAddress } from "../../../platform/db";
import { SYNTHETIC_MESSAGE_ID_LIKE, type TestMailRule } from "../seed";

// The test-mail rule for a `sent_emails` row that the query names `s`: a synthetic Message-ID, or a sender in the rule. It is the rule
// of the synthetic scope of the LLM: a real mail never goes to the model there. An empty sender list adds no `IN ()` clause.
export function sentTestMailFilter(rule: TestMailRule): Expression<SqlBool> {
  const senders = rule.senders.map(normalizeAddress);
  const synthetic = sql<boolean>`lower(s.message_id) like ${SYNTHETIC_MESSAGE_ID_LIKE}`;
  if (senders.length === 0) return synthetic;
  return sql<boolean>`(${synthetic} or ${normalizedAddress("s.from_address")} in (${sql.join(senders)}))`;
}
