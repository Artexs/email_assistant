// Gaps: a fact that the drafter does not have becomes `[[label]]`. The server refuses to approve a version with a
// gap (`has_gaps`). Pure code.

export const GAP_LABEL_MAX = 80;

// Fullwidth and other lookalike brackets count as brackets: NFKC turns `［［` into `[[`.
const GAP = new RegExp(String.raw`\[\[([^\[\]]{1,${GAP_LABEL_MAX}})\]\]`, "g");

/** The labels of the gaps, in order. Only a well-formed gap counts; a label of white space only does not. */
export function gapsOf(body: string): string[] {
  const labels: string[] = [];
  for (const match of body.normalize("NFKC").matchAll(GAP)) {
    const label = (match[1] ?? "").trim();
    if (label !== "") labels.push(label);
  }
  return labels;
}

/** True when `[[` appears, well-formed or not. A draft with a gap is not approvable. */
export function hasGaps(body: string): boolean {
  return body.normalize("NFKC").includes("[[");
}

/** True when a `[[` or `]]` stays after the well-formed gaps are removed: `[[]]`, `[[a [b]]`, `[[ ]]`, `x]]`. */
export function hasBrokenGapSyntax(body: string): boolean {
  const rest = body.normalize("NFKC").replace(GAP, (_match, label: string) => (label.trim() === "" ? "[[" : ""));
  return rest.includes("[[") || rest.includes("]]");
}

/** The body with each well-formed gap replaced by `replacement`. */
export function replaceGaps(body: string, replacement: string): string {
  return body.normalize("NFKC").replace(GAP, replacement);
}

/** The body without its gaps: the language and length rules read the sentences, not the labels. */
export function withoutGaps(body: string): string {
  return replaceGaps(body, " ");
}
