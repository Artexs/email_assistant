// One place for the message texts of every locale. The browser imports it through `@ea/core/web`: no Node module here.
import type { UserLocale } from "../tenancy";

import { aiTextTexts, type AiTextTexts } from "./ai-text";
import { answerTexts, type AnswerTexts } from "./answers";
import { approvalTexts, type ApprovalTexts } from "./approvals";
import { attachmentTexts, type AttachmentTexts } from "./attachments";
import { botTexts, type BotCommandName, type BotTexts } from "./bot";
import { briefTexts, type BriefTexts } from "./brief";
import { categoryTexts, type CategoryTexts } from "./categories";
import { clockTexts, type ClockTexts } from "./clock";
import { commonTexts, type CommonTexts } from "./common";
import { digestTexts, type DigestTexts } from "./digest";
import { followUpTexts, type FollowUpTexts } from "./follow-up";
import { loopTapTexts, type LoopTapTexts } from "./loop-taps";
import { noticeTexts, type NoticeTexts } from "./notices";
import { operatorTexts, type OperatorTexts } from "./operator";
import { replyMailTexts, type ReplyMailTexts } from "./reply-mail";
import { reportMailTexts, type ReportMailTexts } from "./report-mail";
import { reviewTexts, type ReviewTexts } from "./review";
import { suspiciousTexts, type SuspiciousTexts } from "./suspicious";
import { whyTexts, type WhyTexts } from "./why";
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
  BriefTexts,
  CategoryTexts,
  ClockTexts,
  CommonTexts,
  DigestTexts,
  FollowUpTexts,
  LoopTapTexts,
  NoticeTexts,
  OperatorTexts,
  ReplyMailTexts,
  ReportMailTexts,
  ReviewTexts,
  SuspiciousTexts,
  WhyTexts,
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
  operator: OperatorTexts;
  reportMail: ReportMailTexts;
  approvals: ApprovalTexts;
  review: ReviewTexts;
  digest: DigestTexts;
  brief: BriefTexts;
  loopTaps: LoopTapTexts;
  followUp: FollowUpTexts;
  replyMail: ReplyMailTexts;
  suspicious: SuspiciousTexts;
  why: WhyTexts;
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
    operator: operatorTexts.en,
    reportMail: reportMailTexts.en,
    approvals: approvalTexts.en,
    review: reviewTexts.en,
    digest: digestTexts.en,
    brief: briefTexts.en,
    loopTaps: loopTapTexts.en,
    followUp: followUpTexts.en,
    replyMail: replyMailTexts.en,
    suspicious: suspiciousTexts.en,
    why: whyTexts.en,
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
    operator: operatorTexts.pl,
    reportMail: reportMailTexts.pl,
    approvals: approvalTexts.pl,
    review: reviewTexts.pl,
    digest: digestTexts.pl,
    brief: briefTexts.pl,
    loopTaps: loopTapTexts.pl,
    followUp: followUpTexts.pl,
    replyMail: replyMailTexts.pl,
    suspicious: suspiciousTexts.pl,
    why: whyTexts.pl,
    bot: botTexts.pl,
  },
};

export function textsFor(locale: UserLocale): CoreTexts {
  return textTables[locale];
}
