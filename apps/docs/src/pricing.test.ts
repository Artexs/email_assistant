import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { costModel, costToRun, PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH, pilotCost, type PilotCost } from "@ea/core";

import {
  basisNote,
  costBasis,
  costRows,
  formatUsd,
  hostSizeNote,
  placeholderPrice,
  ROUNDING_NOTE,
  roundingNote,
} from "./pricing";

const ROOT = join(import.meta.dir, "../../..");
const COST_DOC = readFileSync(join(ROOT, "docs/cost-model.md"), "utf8");
const PAGE_SOURCE = readFileSync(join(import.meta.dir, "content/docs/pricing.mdx"), "utf8");
const BUILT_PAGE = join(import.meta.dir, "../dist/pricing/index.html");
const BUILT_PAGE_PL = join(import.meta.dir, "../dist/pl/pricing/index.html");

const pilotAtBase: PilotCost = { ...pilotCost, triagedMails: 87, llmUsd: 0.0914, llmCalls: 276, unpricedCalls: 0 };
const pilotMeasured: PilotCost = { ...pilotCost, triagedMails: 1000, llmUsd: 1, llmCalls: 1000, unpricedCalls: 0 };
const withPilot = (pilot: PilotCost) => (mailsPerDay: number) => costToRun(mailsPerDay, { pilot });

/** The `<tr>` rows of the first table of the cost doc section, as cells. */
function docRows(title: string): string[][] {
  const lines = COST_DOC.split("\n");
  const start = lines.indexOf(`## ${title}`);
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
  return rows.slice(1);
}

describe("placeholderPrice", () => {
  test("goes through formatUsd: whole dollars lose the cents, other prices keep two decimals, in both languages", () => {
    expect(placeholderPrice("en", 25)).toBe("$25");
    expect(placeholderPrice("pl", 25)).toBe("25 USD");
    expect(placeholderPrice("en", 24.5)).toBe("$24.50");
    expect(placeholderPrice("pl", 24.5)).toBe("24,50 USD");
    expect(placeholderPrice("pl")).toBe(placeholderPrice("pl", PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH));
  });
});

describe("costRows", () => {
  test("1. three rows at 50, 100 and 200 mails a day, in this order", () => {
    expect(costRows().map((row) => row.mailsPerDay)).toEqual([50, 100, 200]);
  });

  test("2. the base pilot block gives the totals and margins of the cost doc and the basis estimate", () => {
    const compute = withPilot(pilotAtBase);
    const rows = costRows(compute);
    expect(rows.map((row) => row.totalUsd)).toEqual([0.62, 0.83, 1.26]);
    expect(rows.map((row) => row.marginUsd)).toEqual([24.38, 24.17, 23.74]);
    expect(costBasis(compute)).toBe("estimate");
  });

  test("3. a measured pilot of 1,000 mails gives LLM 1.50, total 1.91 and margin 23.09 at 50 mails a day", () => {
    const compute = withPilot(pilotMeasured);
    const [first] = costRows(compute);
    expect(first?.llmUsd).toBe(1.5);
    expect(first?.totalUsd).toBe(1.91);
    expect(first?.marginUsd).toBe(23.09);
    expect(costBasis(compute)).toBe("measured");
  });

  test("4. with the real costToRun, each row equals the doc table at 20 mailboxes per host and its margin", () => {
    expect(costModel.mailboxesPerHost).toBe(20);
    const cost = docRows("Cost per mailbox per month").filter((cells) => Number(cells[1]) === 20);
    const price = docRows("Price").filter((cells) => Number(cells[1]) === 20);
    for (const row of costRows()) {
      const costCells = cost.find((cells) => Number(cells[0]) === row.mailsPerDay);
      const priceCells = price.find((cells) => Number(cells[0]) === row.mailsPerDay);
      expect(costCells?.slice(2)).toEqual(
        [row.llmUsd, row.hostingUsd, row.backupUsd, row.totalUsd].map((value) => value.toFixed(2))
      );
      expect(priceCells?.slice(2)).toEqual([row.totalUsd.toFixed(2), row.marginUsd.toFixed(2)]);
    }
    expect(COST_DOC).toContain(`$${PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH} per mailbox per month`);
  });
});

describe("notes", () => {
  test("the estimate note and the measured note", () => {
    expect(basisNote("estimate")).toBe("Estimate: the measured data is too small.");
    const note = basisNote("measured");
    expect(note).toContain(pilotCost.measuredOn);
    expect(note).toContain(`${pilotCost.weeks.length} weeks`);
    for (const model of pilotCost.models) expect(note).not.toContain(model);
  });
});

// The text of a built page: no script, no style, no tag; entities decoded.
function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** The cells of the body rows of the first table, as text. */
function bodyRows(html: string): string[][] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...(row[1] ?? "").matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => pageText(cell[1] ?? "").trim())
  );
}

/** Each place that names Gemini must carry its condition. The default pages name none. */
function geminiOutsideCondition(text: string): string[] {
  return [...text.matchAll(/gemini/gi)]
    .filter((match) => {
      const index = match.index ?? 0;
      return !text.slice(Math.max(0, index - 200), index + 200).includes("optional, off by default");
    })
    .map((match) => match[0]);
}

describe("the pricing page", () => {
  test("7. the source holds no Gemini text outside its condition", () => {
    expect(geminiOutsideCondition(PAGE_SOURCE)).toEqual([]);
  });

  test("the Gemini check flags a bare mention and accepts a conditional one", () => {
    expect(geminiOutsideCondition("We use Gemini.")).toEqual(["Gemini"]);
    expect(geminiOutsideCondition("Gemini is optional, off by default.")).toEqual([]);
  });

  test("5. the built page shows every cell of costRows, the host size line and the rounding line (runs after docs:build)", () => {
    if (!existsSync(BUILT_PAGE)) return;
    const html = readFileSync(BUILT_PAGE, "utf8");
    expect(bodyRows(html)).toEqual(
      costRows().map((row) => [
        String(row.mailsPerDay),
        ...[row.llmUsd, row.hostingUsd, row.backupUsd, row.totalUsd, row.marginUsd].map((value) => formatUsd(value)),
      ])
    );
    const text = pageText(html);
    expect(text).toContain(hostSizeNote());
    expect(text).toContain(`${costModel.mailboxesPerHost} mailboxes per host`);
    expect(text).toContain(ROUNDING_NOTE);
    expect(text).toContain(basisNote(costBasis()));
    expect(text).toContain(
      "Not for sale. This is a placeholder price for a product that is built to a sale standard; there is no checkout."
    );
    expect(geminiOutsideCondition(text)).toEqual([]);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/<input[\s>]/i);
  });

  test("5pl. the built Polish page shows every cell of costRows in Polish format, and holds no English label (runs after docs:build)", () => {
    if (!existsSync(BUILT_PAGE_PL)) return;
    const html = readFileSync(BUILT_PAGE_PL, "utf8");
    expect(bodyRows(html)).toEqual(
      costRows().map((row) => [
        String(row.mailsPerDay),
        ...[row.llmUsd, row.hostingUsd, row.backupUsd, row.totalUsd, row.marginUsd].map((value) =>
          formatUsd(value, "pl")
        ),
      ])
    );
    const text = pageText(html);
    expect(text).toContain(hostSizeNote("pl"));
    expect(text).toContain(roundingNote("pl"));
    expect(text).toContain(basisNote(costBasis(), undefined, "pl"));
    expect(text).toContain("Nie na sprzedaż.");
    expect(text).toContain(placeholderPrice("pl"));
    expect(text).not.toContain("Not for sale");
    expect(text).not.toContain("Mails a day");
    expect(geminiOutsideCondition(text)).toEqual([]);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/<input[\s>]/i);
  });
});
