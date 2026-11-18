export { checkReplyBody, DRAFT_MAX_CHARS, REPLY_CHECK_CODES, UNKNOWN_LANGUAGE_MAX_CHARS } from "./checks";
export type { ReplyCheckCode, ReplyCheckResult } from "./checks";
export { GAP_LABEL_MAX, gapsOf, hasBrokenGapSyntax, hasGaps } from "./gaps";
export { detectLanguage } from "./language";
export type { DetectedLanguage } from "./language";
export { DRAFTER_BODY_MAX, drafterOutputSchema, noDraftReasons } from "./schema";
export type { DrafterOutput, NoDraftReason } from "./schema";
export { normalizeDraftText } from "./text";
export { cutChars, DRAFTER_MAIL_BODY_MAX, DRAFTER_NAME_MAX, DRAFTER_SUBJECT_MAX } from "./input";
export type { DrafterInput } from "./input";
export { QUOTE_NAME_MAX_CHARS, quoteReply } from "./quote";
export { draftCopyKey } from "./copy-key";
export type { DraftCopy } from "./copy-key";
export { DIGIT_BUDGET, digitVerdict, IBAN_LENGTHS, ibansOf, LONG_SEQUENCE_DIGITS } from "./digits";
export type { DigitVerdict } from "./digits";
export { isAutoSubmitted, REPLY_AUTO_MAX_AGE_MS, REPLY_BLOCK_REASONS, replyEligibility } from "./eligibility";
export type {
  ReplyBlockReason,
  ReplyEligibility,
  ReplyFacts,
  ReplyHeaderFacts,
  ReplyLanguage,
  ReplyTrigger,
} from "./eligibility";
export {
  checkProfileInput,
  PROFILE_NAME_MAX,
  PROFILE_SIGNATURE_MAX,
  PROFILE_STYLE_MAX,
  profileErrorCodes,
  profileFallbacks,
  profileFields,
  profileLength,
  resolveReplyStyle,
} from "./profile";
export type { ProfileCheck, ProfileErrorCode, ProfileField, ProfileFields, ProfileInput } from "./profile";
export { STYLE_FORM_LINE_MAX, styleAddressForms, styleFromForm, styleLengths } from "./style-form";
export type { StyleAddressForm, StyleForm, StyleLength, StyleLocale } from "./style-form";
export { SAMPLE_MAIL } from "./sample-mail";
export type { SampleMail } from "./sample-mail";
