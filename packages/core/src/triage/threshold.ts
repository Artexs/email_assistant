import type { TriageAnalysis } from "./analysis";
import type { Category } from "./categories";
import { thresholdFor, type CategoryPolicy } from "./settings";

export function decideCategory(
  analysis: Pick<TriageAnalysis, "category" | "confidence">,
  policy: CategoryPolicy
): { category: Category; belowThreshold: boolean } {
  if (analysis.confidence < thresholdFor(policy, analysis.category)) {
    return { category: "unsure", belowThreshold: true };
  }
  return { category: analysis.category, belowThreshold: false };
}
