// One place for the message texts of every locale. The browser imports it through `@ea/core/web`: no Node module here.
import type { UserLocale } from "../tenancy";

import { aiTextTexts, type AiTextTexts } from "./ai-text";
import { answerTexts, type AnswerTexts } from "./answers";
import { approvalTexts, type ApprovalTexts } from "./approvals";
import { categoryTexts, type CategoryTexts } from "./categories";
import { clockTexts, type ClockTexts } from "./clock";
import { commonTexts, type CommonTexts } from "./common";
import { noticeTexts, type NoticeTexts } from "./notices";
import { wouldDoTexts, type WouldDoTexts } from "./would-do";

export type { ActionTense, SendPhraseStatus } from "./would-do";
export type {
  AiTextTexts,
  AnswerTexts,
  ApprovalTexts,
  CategoryTexts,
  ClockTexts,
  CommonTexts,
  NoticeTexts,
  WouldDoTexts,
};

export interface CoreTexts {
  locale: UserLocale;
  clock: ClockTexts;
  categories: CategoryTexts;
  answers: AnswerTexts;
  aiText: AiTextTexts;
  wouldDo: WouldDoTexts;
  common: CommonTexts;
  notices: NoticeTexts;
  approvals: ApprovalTexts;
  // Stages 10–11 add digest, bot.
}

export const textTables: Record<UserLocale, CoreTexts> = {
  en: {
    locale: "en",
    clock: clockTexts.en,
    categories: categoryTexts.en,
    answers: answerTexts.en,
    aiText: aiTextTexts.en,
    wouldDo: wouldDoTexts.en,
    common: commonTexts.en,
    notices: noticeTexts.en,
    approvals: approvalTexts.en,
  },
  pl: {
    locale: "pl",
    clock: clockTexts.pl,
    categories: categoryTexts.pl,
    answers: answerTexts.pl,
    aiText: aiTextTexts.pl,
    wouldDo: wouldDoTexts.pl,
    common: commonTexts.pl,
    notices: noticeTexts.pl,
    approvals: approvalTexts.pl,
  },
};

// Telegram and the panel phrases switch to Polish together in stage 12 of the plan in the ticket folder
// F098-e7-t1-polish-ui-i18n-frame-first (D10); until then every locale gets English.
const POLISH_MESSAGES_ON = false;

export function textsFor(locale: UserLocale): CoreTexts {
  return POLISH_MESSAGES_ON ? textTables[locale] : textTables.en;
}
