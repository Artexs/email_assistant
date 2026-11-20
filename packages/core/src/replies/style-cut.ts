// The text a manager wrote in a sent mail, with the quoted older mail, the signature and the forwarded part cut off.
// The style suggestion reads only this text. Pure code.

// "On <date>, <name> wrote:" and "W dniu <date> <name> pisze:" start a line; "<name> napisał(a):" ends one.
const EN_WROTE_START = /^\s*On\s.+/i;
const EN_WROTE_END = /\swrote:\s*$/i;
const PL_PISZE_START = /^\s*W dniu\s.+/i;
const PL_PISZE_END = /\spisze:\s*$/i;
const PL_NAPISAL_END = /\snapisał(?:\(a\)|a)?:\s*$/i;
// `--- Original message ---`, `-----Original Message-----`, `--- Oryginalna wiadomość ---`.
const ORIGINAL_LINE = /^\s*-{2,}\s*(?:Original Message|Oryginalna wiadomość)\s*-{2,}\s*$/i;
// `---------- Forwarded message ---------`, `Wiadomość przekazana` (Thunderbird: `Przekazana wiadomość`) with any run of dashes around it.
const FORWARD_LINE = /^\s*-*\s*(?:Forwarded message|Wiadomość przekazana|Przekazana wiadomość)\s*-*\s*$/i;
const RULE_LINE = /^\s*[_-]{10,}\s*$/;
// Polish Outlook writes `Wysłane:`; older clients write `Wysłano:`.
const HEADER_FIELD = /^\s*(?:From|Od|Sent|Wysłan[eo]|Date|Data|To|Do|Cc|DW|Subject|Temat)\s*:/i;
const HEADER_START = /^\s*(?:From|Od)\s*:/i;
// The first line of a block of mail headers that Outlook and OWA put above the older mail.
const MIN_HEADER_LINES = 2;

function startsWrote(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  const oneLine = (start: RegExp, end: RegExp, text: string): boolean => start.test(text) && end.test(text);
  if (oneLine(EN_WROTE_START, EN_WROTE_END, line) || oneLine(PL_PISZE_START, PL_PISZE_END, line)) return true;
  // The header wraps on a second line.
  if (EN_WROTE_START.test(line) && EN_WROTE_END.test(next)) return true;
  if (PL_PISZE_START.test(line) && PL_PISZE_END.test(next)) return true;
  return PL_NAPISAL_END.test(line);
}

function startsHeaderBlock(lines: string[], index: number): boolean {
  if (!HEADER_START.test(lines[index] ?? "")) return false;
  let count = 0;
  while (HEADER_FIELD.test(lines[index + count] ?? "")) count += 1;
  return count >= MIN_HEADER_LINES;
}

/** The index of the first line of the quoted or forwarded part, or `lines.length` when there is none. */
function cutIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (ORIGINAL_LINE.test(line) || FORWARD_LINE.test(line) || startsWrote(lines, i)) return i;
    if (startsHeaderBlock(lines, i)) {
      const before = i === 0 ? "" : (lines[i - 1] ?? "");
      if (before.trim() === "" || RULE_LINE.test(before)) return RULE_LINE.test(before) ? i - 1 : i;
    }
  }
  return lines.length;
}

function signatureLines(signature: string | null): string[] {
  return (signature ?? "")
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// A signature that was written on one line: "Pozdrawiam | Wiktor Szalewski" or "Pozdrawiam Wiktor Szalewski".
function withoutInlineSignature(line: string, parts: string[]): string {
  if (parts.length === 0) return line;
  const trimmed = line.trimEnd();
  for (const joiner of [" | ", " "]) {
    const inline = parts.join(joiner);
    if (trimmed.endsWith(inline)) return trimmed.slice(0, trimmed.length - inline.length);
  }
  return line;
}

/**
 * The text above the first reply header, with no `>` line, ending at a line `-- ` or `--`, with no line that equals
 * a line of the stored signature and no copy of it at the end of the last line. LF line ends. Trimmed.
 */
export function cutQuotedReply(text: string, opts: { signature: string | null }): string {
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  const lines = all.slice(0, cutIndex(all));
  const signature = signatureLines(opts.signature);
  const kept: string[] = [];
  for (const line of lines) {
    if (line.trimEnd() === "--") break;
    if (line.trimStart().startsWith(">")) continue;
    if (signature.includes(line.trim())) continue;
    kept.push(line);
  }
  let last = kept.length - 1;
  while (last >= 0 && (kept[last] ?? "").trim() === "") last -= 1;
  if (last >= 0) kept[last] = withoutInlineSignature(kept[last] ?? "", signature);
  return kept
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
