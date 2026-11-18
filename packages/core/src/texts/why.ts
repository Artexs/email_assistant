import type { UserLocale } from "../tenancy";
import type { SenderRuleKind } from "../triage/rules";

// The "why" part of a digest item and of the urgent notice (flag `why_lines`). Fixed phrases only: the delegate
// tags are the organization's own words (user config), cut in the builder.
export interface WhyTexts {
  // The mark of a result that a sender rule shaped. It replaces the percent: a rule is not a model mark.
  rule: Record<SenderRuleKind, string>;
  // The label of the competence tags of a delegate, joined with commas. The would-do phrase of a delegation draft puts it next to the name.
  fits: (tags: string) => string;
}

export const whyTexts = {
  en: {
    rule: { vip: "rule: VIP sender", whitelist: "rule: whitelisted sender", blocklist: "rule: blocked sender" },
    fits: (tags) => `skills: ${tags}`,
  },
  pl: {
    rule: {
      vip: "reguła: nadawca VIP",
      whitelist: "reguła: nadawca z listy dozwolonych",
      blocklist: "reguła: nadawca z listy blokowanych",
    },
    fits: (tags) => `kompetencje: ${tags}`,
  },
} satisfies Record<UserLocale, WhyTexts>;
