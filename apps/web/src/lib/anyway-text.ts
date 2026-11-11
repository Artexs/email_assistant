import type { BarCategory } from "@ea/core/web";

import type { TextKey } from "../i18n/en";

// Auto changes nothing (urgent) or only sets a flag (needs_reply), so the move text would be false there.
const quietCategories: readonly BarCategory[] = ["urgent", "needs_reply"];

export function anywayTextKey(category: BarCategory): TextKey {
  return quietCategories.includes(category) ? "anyway_text_quiet" : "anyway_text";
}
