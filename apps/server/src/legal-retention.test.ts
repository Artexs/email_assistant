import { readFileSync } from "node:fs";
import path from "node:path";

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

// Reply texts: ONE period and ONE cut-off column. The period is the text period of the job
// (`RETENTION_TEXT_DAYS`), not `data_retention_days`; the column is `created_at`. The four places agree: the job
// (`retention.ts` and `clearReplyTexts`, pinned by `replies-retention.test.ts`), the category `reply-texts`, `docs/architecture.md`
// §7 and `docs/legal/records-of-processing.md`.
describe("reply texts: one period and one cut-off column", () => {
  const ROOT = path.resolve(import.meta.dir, "../../..");
  const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
  const rowOf = (markdown: string, needle: string) => markdown.split("\n").find((line) => line.includes(needle)) ?? "";

  test("the category keeps both columns for the text period", () => {
    for (const column of ["instruction", "sample_body"]) {
      expect(keptOf("reply_requests", column)).toEqual({ kind: "days", days: RETENTION_TEXT_DAYS });
    }
  });

  test("the job counts from created_at: the function reads that column and no other", () => {
    const source = read("apps/server/src/modules/replies/retention.ts");
    expect(source).toContain('.where("created_at", "<", opts.before)');
    expect(source).not.toContain('"updated_at", "<"');
    const job = read("apps/server/src/retention.ts");
    expect(job).toContain("clearers.clearReplyTexts(db, ctx, { before: textsBefore })");
  });

  test("§7 of the architecture and the records of processing name the same period and the same column", () => {
    const architecture = rowOf(read("docs/architecture.md"), "`reply_requests.instruction`");
    const records = rowOf(read("docs/legal/records-of-processing.md"), "| `reply-texts`");
    for (const row of [architecture, records]) {
      expect(row).toContain(`${RETENTION_TEXT_DAYS} days`);
      expect(row).toContain("`created_at`");
      expect(row).not.toContain("last change");
      expect(row).not.toContain("<to confirm");
    }
    expect(architecture).toContain("`RETENTION_TEXT_DAYS`");
    expect(architecture).toContain("`clearReplyTexts`");
    expect(read("docs/legal/records-of-processing.md")).not.toContain("<to confirm: cut-off column>");
  });
});
