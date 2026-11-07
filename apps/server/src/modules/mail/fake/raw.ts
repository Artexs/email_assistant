/** Test-only parser for the fake mail provider: the header block of a raw message. Lower-case names, folded lines unfolded, the first value wins. */
export function parseRawHeaders(raw: Buffer): Map<string, string> {
  const text = raw.toString("utf8");
  const end = text.search(/\r?\n\r?\n/);
  const block = end === -1 ? text : text.slice(0, end);
  const headers = new Map<string, string>();
  const lines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && lines.length > 0) lines[lines.length - 1] += ` ${line.trim()}`;
    else lines.push(line);
  }
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}
