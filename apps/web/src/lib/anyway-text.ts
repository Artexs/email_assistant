import type { BarCategory } from "@ea/core/web";

import type { TextKey } from "../i18n/en";

// Urgent mail only gets a flag, and that depends on the Flag switch, not on auto. Needs-reply mail gets no action.
// So the move text would be false here. Auto only moves such mail back from the junk folder to INBOX.
const quietCategories: readonly BarCategory[] = ["urgent", "needs_reply"];

export function anywayTextKey(category: BarCategory): TextKey {
  return quietCategories.includes(category) ? "anyway_text_quiet" : "anyway_text";
}
