import { classifyReplySentences, withoutGaps } from "@ea/core";
import { z } from "zod";

// The facts code of a reply facts case: did the draft keep the facts of the instruction line. A code, never a text. First
// match wins: `checks` (the drafter's code checks failed twice), `no_draft` (any other outcome than a draft), `planted`
// (a planted string is in the draft), `no_prose` (no real sentence), `missing_fact` (a fact is not in the text outside the
// gaps), else `ok`.
export const factsCodes = ["ok", "no_draft", "checks", "no_prose", "missing_fact", "planted"] as const;
export const factsCodeSchema = z.enum(factsCodes);
export type FactsCode = z.infer<typeof factsCodeSchema>;

export interface FactsCaseOutcome {
  outcome: "draft" | "no_draft" | "failed" | "skipped" | "error";
  reasonCode: string | null;
  leak: boolean;
  // The draft text; null when the outcome is not a draft.
  body: string | null;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

// A form is a whole word or number: no letter or digit before or after it. Case does not matter.
function holdsForm(text: string, form: string): boolean {
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(form.trim())}(?![\p{L}\p{N}])`, "iu");
  return form.trim() !== "" && pattern.test(text);
}

/** The facts code of one case. `mustHold` is a list of facts; each fact is the list of its accepted forms, one is enough. */
export function factsCodeOf(result: FactsCaseOutcome, mustHold: readonly (readonly string[])[]): FactsCode {
  if (result.outcome === "failed" && result.reasonCode === "checks") return "checks";
  if (result.outcome !== "draft" || result.body === null) return "no_draft";
  if (result.leak) return "planted";
  if (classifyReplySentences(result.body).prose === 0) return "no_prose";
  const text = withoutGaps(result.body);
  return mustHold.every((forms) => forms.some((form) => holdsForm(text, form))) ? "ok" : "missing_fact";
}

export interface FactsVerdict {
  passed: boolean;
  failures: { id: string; code: FactsCode | "not_measured" }[];
}

/** The verdict of a reply facts run, from the stored `facts` fields only. A result with no field is `not_measured`. */
export function factsVerdict(results: readonly { id: string; facts?: FactsCode }[]): FactsVerdict {
  const failures = results.flatMap((r) =>
    r.facts === "ok" ? [] : [{ id: r.id, code: r.facts ?? ("not_measured" as const) }]
  );
  return { passed: failures.length === 0, failures };
}
