import { type CliDescription, type CliNeed, type CliRisk } from "./description";

const EXIT_CODES_WITH_TEXT = [1, 3, 4] as const;

export function renderHelp(d: CliDescription): string {
  const lines = [
    `usage: ${d.usage}`,
    d.summary,
    `risk: ${d.risk} · needs: ${d.needs.join(", ")}`,
    "exit: 0 done · 1 failed · 2 usage · 3 unreachable · 4 incomplete",
  ];
  for (const code of EXIT_CODES_WITH_TEXT) {
    const text = d.exits?.[code];
    if (text !== undefined) lines.push(`  ${code}: ${text}`);
  }
  if (d.outputNote !== undefined) lines.push(`output: ${d.outputNote}`);
  return `${lines.join("\n")}\n`;
}

export interface CliToolRow {
  name: string;
  risk: CliRisk;
  needs: readonly CliNeed[];
  summary: string;
  available: boolean;
}

const UNAVAILABLE_SUMMARY = "not in this install";

// Rows sorted by name; each column but the last is padded to its widest cell plus two spaces.
export function renderToolTable(rows: readonly CliToolRow[]): string {
  const cells = [...rows]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((row) =>
      row.available
        ? [row.name, row.risk, row.needs.join(", "), row.summary]
        : [row.name, "-", "-", UNAVAILABLE_SUMMARY]
    );
  const widths = [0, 1, 2].map((column) => Math.max(0, ...cells.map((row) => row[column]?.length ?? 0)) + 2);
  const lines = cells.map((row) =>
    row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column] ?? 0) : cell)).join("")
  );
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
