import type { ActiveWhen, Kept, Subprocessor } from "@ea/core/web";

import type { TextKey } from "../i18n/en";
import { fillSlots } from "./legal";

// The texts of the generated tables on the legal pages. `texts` is the dictionary of the page language.
type Dictionary = Record<TextKey, string>;

export function daysText(texts: Dictionary, days: number): string {
  return fillSlots(days === 1 ? texts.legal_days_one : texts.legal_days_other, { days });
}

export function keptText(texts: Dictionary, kept: Kept): string {
  switch (kept.kind) {
    case "orgSetting":
      return fillSlots(texts.legal_kept_org, { days: daysText(texts, kept.defaultDays) });
    case "days":
      return fillSlots(texts.legal_kept_days, { days: daysText(texts, kept.days) });
    case "daysAfterClose":
      return fillSlots(texts.legal_kept_after_close, { days: daysText(texts, kept.days) });
    case "afterExpiry":
      return fillSlots(texts.legal_kept_after_expiry, { days: daysText(texts, kept.days) });
    case "untilDelete":
      return texts.legal_kept_until_delete;
  }
}

// "Used when" of a sub-processor row. A page shows the condition, never a claim that the service is always used,
// and it prints the name of the key, never a value.
export function usedWhenText(texts: Dictionary, row: Pick<Subprocessor, "name">, when: ActiveWhen): string {
  switch (when.kind) {
    case "always":
      return texts.legal_used_always;
    case "llmProvider":
      return fillSlots(texts.legal_used_llm, { provider: row.name });
    case "env":
      return when.unless === undefined
        ? fillSlots(texts.legal_used_env, { key: when.key })
        : fillSlots(texts.legal_used_env_unless, { key: when.key, value: when.unless });
    case "host":
      return texts.legal_used_backup;
  }
}
