// Code in Markdown: fenced blocks and inline code spans. The renderer escapes what is inside, so it can add no element.
// No Node or Astro import: the loader, the content-script check and their tests share this file.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
// A span opens with a run of backticks and closes with a run of the same length.
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

// Tracks code fences line by line: `fence` is the opening marker while inside one.
// `code` is true for a fence line and for a line inside a fence.
export function stepFence(fence: string | null, line: string): { fence: string | null; code: boolean } {
  const marker = FENCE.exec(line)?.[1];
  if (fence === null) return marker ? { fence: marker, code: true } : { fence: null, code: false };
  const closes = marker !== undefined && marker.startsWith(fence.slice(0, 1)) && marker.length >= fence.length;
  return { fence: closes ? null : fence, code: true };
}

// Applies `change` to the text between the code spans of one line; the code spans stay as they are.
export function mapOutsideCode(line: string, change: (text: string) => string): string {
  let result = "";
  let from = 0;
  for (const span of line.matchAll(CODE_SPAN)) {
    result += change(line.slice(from, span.index)) + span[0];
    from = span.index + span[0].length;
  }
  return result + change(line.slice(from));
}

// The line without its code spans (each becomes one space).
export function stripCodeSpans(line: string): string {
  return line.replace(CODE_SPAN, " ");
}
