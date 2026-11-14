// One place for the message texts of every locale. The browser imports it through `@ea/core/web`: no Node module here.
import type { UserLocale } from "../tenancy";

import { aiTextTexts, type AiTextTexts } from "./ai-text";
import { answerTexts, type AnswerTexts } from "./answers";
import { categoryTexts, type CategoryTexts } from "./categories";
import { clockTexts, type ClockTexts } from "./clock";
import { reviewTexts, type ReviewTexts } from "./review";

export type { AiTextTexts, AnswerTexts, CategoryTexts, ClockTexts, ReviewTexts };

export interface CoreTexts {
  locale: UserLocale;
  clock: ClockTexts;
  categories: CategoryTexts;
  answers: AnswerTexts;
  aiText: AiTextTexts;
  review: ReviewTexts;
  // Stage 07 adds wouldDo; stages 08–11 add common, notices, approvals, digest, bot.
}

export const textTables: Record<UserLocale, CoreTexts> = {
  en: {
    locale: "en",
    clock: clockTexts.en,
    categories: categoryTexts.en,
    answers: answerTexts.en,
    aiText: aiTextTexts.en,
    review: reviewTexts.en,
  },
  pl: {
    locale: "pl",
    clock: clockTexts.pl,
    categories: categoryTexts.pl,
    answers: answerTexts.pl,
    aiText: aiTextTexts.pl,
    review: reviewTexts.pl,
  },
};

// Telegram and the panel phrases switch to Polish together in stage 12 of the plan in the ticket folder
// F098-e7-t1-polish-ui-i18n-frame-first (D10); until then every locale gets English.
const POLISH_MESSAGES_ON = false;

export function textsFor(locale: UserLocale): CoreTexts {
  return POLISH_MESSAGES_ON ? textTables[locale] : textTables.en;
}
