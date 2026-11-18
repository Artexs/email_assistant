// The result of a history check from its items: one entry per moving category.
import { historyOutcome, movingCategories, type Category } from "@ea/core";

import type { HistoryResult } from "./repo";

export interface ResultItem {
  category: Category;
  wouldMove: boolean;
  actedOn: boolean;
}

/**
 * `acted` = the acted-on items; `moved` = the acted-on items that the category would move. `total` = all items, `wouldMove` = the items that
 * the category would move (acted on or not): the two counts of the report. The outcome comes from `historyOutcome`.
 */
export function historyResultOf(items: readonly ResultItem[]): Required<HistoryResult> {
  const acted = items.filter((item) => item.actedOn).length;
  const entries = movingCategories.map((category) => {
    const moves = items.filter((item) => item.category === category && item.wouldMove);
    const moved = moves.filter((item) => item.actedOn).length;
    const { outcome, upper } = historyOutcome({ acted, moved });
    return [category, { outcome, acted, moved, upper, total: items.length, wouldMove: moves.length }] as const;
  });
  return Object.fromEntries(entries) as Required<HistoryResult>;
}
