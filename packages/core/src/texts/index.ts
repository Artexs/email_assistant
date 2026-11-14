// One place for the message texts of every locale. The browser imports it through `@ea/core/web`: no Node module here.
import type { UserLocale } from "../tenancy";

import { aiTextTexts, type AiTextTexts } from "./ai-text";
import { answerTexts, type AnswerTexts } from "./answers";
import { approvalTexts, type ApprovalTexts } from "./approvals";
import { botTexts, type BotCommandName, type BotTexts } from "./bot";
import { categoryTexts, type CategoryTexts } from "./categories";
import { clockTexts, type ClockTexts } from "./clock";
import { commonTexts, type CommonTexts } from "./common";
import { digestTexts, type DigestTexts } from "./digest";
import { noticeTexts, type NoticeTexts } from "./notices";
import { reviewTexts, type ReviewTexts } from "./review";
import { wouldDoTexts, type WouldDoTexts } from "./would-do";

export { botCommandNames } from "./bot";
export type { ActionTense, SendPhraseStatus } from "./would-do";
export type {
  AiTextTexts,
  AnswerTexts,
  ApprovalTexts,
  BotCommandName,
  BotTexts,
  CategoryTexts,
  ClockTexts,
  CommonTexts,
  DigestTexts,
  NoticeTexts,
  ReviewTexts,
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
  review: ReviewTexts;
  digest: DigestTexts;
  bot: BotTexts;
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
    review: reviewTexts.en,
    digest: digestTexts.en,
    bot: botTexts.en,
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
    review: reviewTexts.pl,
    digest: digestTexts.pl,
    bot: botTexts.pl,
  },
};

export function textsFor(locale: UserLocale): CoreTexts {
  return textTables[locale];
}
