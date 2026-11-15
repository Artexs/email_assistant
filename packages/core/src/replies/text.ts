// Plain text rules for a draft body. Pure code.

/** CRLF and a lone CR become LF; trailing spaces of each line and trailing blank lines are cut. */
export function normalizeDraftText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+$/u, ""))
    .join("\n")
    .replace(/\n+$/, "");
}
