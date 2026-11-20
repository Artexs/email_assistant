import { readFileSync } from "node:fs";
import path from "node:path";

import { costToRun, PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH, roundedCostRow } from "@ea/core";
import { describe, expect, test } from "bun:test";

const ROOT = path.resolve(import.meta.dir, "../../..");
const doc = readFileSync(path.join(ROOT, "docs/cost-model.md"), "utf8");

/** The data rows of the table that follows the first heading `## <title>`: each row as its cells. */
function tableRows(markdown: string, title: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) throw new Error(`no section ${title}`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // without the header row
}

describe("helpers", () => {
  test("tableRows skips the header and the separator", () => {
    expect(tableRows("## T\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## U\n| 9 | 9 |", "T")).toEqual([["1", "2"]]);
  });
});

describe("docs/cost-model.md", () => {
  test("6. every cell of the cost table is costToRun rounded to 2 decimals", () => {
    const rows = tableRows(doc, "Cost per mailbox per month");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const cells of rows) {
      const mails = Number(cells[0]);
      const perHost = Number(cells[1]);
      const cost = costToRun(mails, { mailboxesPerHost: perHost });
      const row = roundedCostRow(cost, PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH);
      expect(cells.slice(2)).toEqual(
        [row.llmUsd, row.hostingUsd, row.backupUsd, row.totalUsd].map((v) => v.toFixed(2))
      );
    }
  });

  test("6. every cell of the price table is the total and the margin of costToRun", () => {
    const rows = tableRows(doc, "Price");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const cells of rows) {
      const cost = costToRun(Number(cells[0]), { mailboxesPerHost: Number(cells[1]) });
      const row = roundedCostRow(cost, PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH);
      expect(cells.slice(2)).toEqual([row.totalUsd.toFixed(2), row.marginUsd.toFixed(2)]);
    }
  });

  test("the Price section states the placeholder price constant", () => {
    const start = doc.indexOf("## Price");
    expect(start).toBeGreaterThan(-1);
    expect(doc.slice(start)).toContain(`$${PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH}`);
  });

  test("the doc states the basis that costToRun gives", () => {
    expect(doc).toContain(`Basis: ${costToRun(100).basis}`);
  });

  test("the doc names no ticket folder path", () => {
    expect(doc).not.toMatch(/spec\/features/);
  });
});
