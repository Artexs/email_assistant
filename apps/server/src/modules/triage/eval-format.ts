// Small text helpers shared by the eval report files.
export const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
export const num = (value: number | null, digits = 0): string => (value === null ? "n/a" : value.toFixed(digits));
export const usd = (value: number | null): string => (value === null ? "n/a" : `$${value.toFixed(6)}`);
export const row = (cells: (string | number)[]): string => `| ${cells.join(" | ")} |`;

export function table(head: string[], rows: (string | number)[][]): string[] {
  return [row(head), row(head.map(() => "---")), ...rows.map(row), ""];
}
