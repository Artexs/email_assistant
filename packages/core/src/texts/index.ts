// One place for the message texts of every locale. The browser imports it through `@ea/core/web`: no Node module here.
import type { UserLocale } from "../tenancy";

import { aiTextTexts, type AiTextTexts } from "./ai-text";
import { answerTexts, type AnswerTexts } from "./answers";
import { approvalTexts, type ApprovalTexts } from "./approvals";
import { attachmentTexts, type AttachmentTexts } from "./attachments";
import { botTexts, type BotCommandName, type BotTexts } from "./bot";
import { categoryTexts, type CategoryTexts } from "./categories";
import { clockTexts, type ClockTexts } from "./clock";
import { commonTexts, type CommonTexts } from "./common";
import { digestTexts, type DigestTexts } from "./digest";
import { followUpTexts, type FollowUpTexts } from "./follow-up";
import { noticeTexts, type NoticeTexts } from "./notices";
import { reviewTexts, type ReviewTexts } from "./review";
import { suspiciousTexts, type SuspiciousTexts } from "./suspicious";
import { wouldDoTexts, type WouldDoTexts } from "./would-do";

export { botCommandNames } from "./bot";
export type { ActionTense, SendPhraseStatus } from "./would-do";
export type {
  AiTextTexts,
  AnswerTexts,
  ApprovalTexts,
  AttachmentTexts,
  BotCommandName,
  BotTexts,
  CategoryTexts,
  ClockTexts,
  CommonTexts,
  DigestTexts,
  FollowUpTexts,
  NoticeTexts,
  ReviewTexts,
  SuspiciousTexts,
  WouldDoTexts,
};

export interface CoreTexts {
  locale: UserLocale;
  clock: ClockTexts;
  categories: CategoryTexts;
  answers: AnswerTexts;
  aiText: AiTextTexts;
  attachments: AttachmentTexts;
  wouldDo: WouldDoTexts;
  common: CommonTexts;
  notices: NoticeTexts;
  approvals: ApprovalTexts;
  review: ReviewTexts;
  digest: DigestTexts;
  followUp: FollowUpTexts;
  suspicious: SuspiciousTexts;
  bot: BotTexts;
}

export const textTables: Record<UserLocale, CoreTexts> = {
  en: {
    locale: "en",
    clock: clockTexts.en,
    categories: categoryTexts.en,
    answers: answerTexts.en,
    aiText: aiTextTexts.en,
    attachments: attachmentTexts.en,
    wouldDo: wouldDoTexts.en,
    common: commonTexts.en,
    notices: noticeTexts.en,
    approvals: approvalTexts.en,
    review: reviewTexts.en,
    digest: digestTexts.en,
    followUp: followUpTexts.en,
    suspicious: suspiciousTexts.en,
    bot: botTexts.en,
  },
  pl: {
    locale: "pl",
    clock: clockTexts.pl,
    categories: categoryTexts.pl,
    answers: answerTexts.pl,
    aiText: aiTextTexts.pl,
    attachments: attachmentTexts.pl,
    wouldDo: wouldDoTexts.pl,
    common: commonTexts.pl,
    notices: noticeTexts.pl,
    approvals: approvalTexts.pl,
    review: reviewTexts.pl,
    digest: digestTexts.pl,
    followUp: followUpTexts.pl,
    suspicious: suspiciousTexts.pl,
    bot: botTexts.pl,
  },
};

export function textsFor(locale: UserLocale): CoreTexts {
  return textTables[locale];
}
