import { categoryOfColumn, type Kept } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { RETENTION_TEXT_DAYS } from "./retention";

// The data-category registry states the retention periods that the retention job applies (`docs/capabilities/retention.md`
// rule 2). A change of a period in one place fails here until the other follows.
function keptOf(table: string, column: string): Kept | undefined {
  return categoryOfColumn(table, column)?.kept;
}

describe("data categories: retention pins", () => {
  test("8. the fixed pins", () => {
    expect(keptOf("emails", "body_text")).toEqual({ kind: "orgSetting", defaultDays: 30 });
    expect(keptOf("email_headers", "from_name")).toMatchObject({ kind: "orgSetting" });
    expect(keptOf("email_headers", "attachments")).toMatchObject({ kind: "orgSetting" });
    expect(keptOf("emails", "subject")).toEqual({ kind: "days", days: 90 });
    expect(keptOf("emails", "dedup_key")).toEqual({ kind: "untilDelete" });
    expect(keptOf("chat_links", "external_chat_id")).toEqual({ kind: "untilDelete" });
    expect(keptOf("actions", "provider_result")).toEqual({ kind: "untilDelete" });
    expect(keptOf("delegations", "task_summary")).toEqual({ kind: "daysAfterClose", days: 90 });
  });

  test("the 90-day text period equals RETENTION_TEXT_DAYS", () => {
    expect(RETENTION_TEXT_DAYS).toBe(90);
    expect(keptOf("emails", "subject")).toEqual({ kind: "days", days: RETENTION_TEXT_DAYS });
  });
});
