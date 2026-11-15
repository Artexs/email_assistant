import type { UserLocale } from "../tenancy";
import type { SenderRuleKind } from "../triage/rules";

// The "why" part of a digest item and of the urgent notice (F110 stage 16, flag `why_lines`). Fixed phrases only: the delegate
// tags are the organization's own words (user config), cut in the builder.
export interface WhyTexts {
  // The mark of a result that a sender rule shaped. It replaces the percent: a rule is not a model mark.
  rule: Record<SenderRuleKind, string>;
  // The competence tags of the chosen delegate, joined with commas, after the "would do" line of a delegation item.
  fits: (tags: string) => string;
}

export const whyTexts = {
  en: {
    rule: { vip: "rule: VIP sender", whitelist: "rule: whitelisted sender", blocklist: "rule: blocked sender" },
    fits: (tags) => `fits: ${tags}`,
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
