// The browser imports only this file (`@ea/core/web`): no module here may pull a Node module.
export * from "./actions";
export * from "./approvals";
export * from "./csp";
export * from "./activity";
export * from "./delegation";
export * from "./errors";
export * from "./legal-version";
export * from "./loops";
export * from "./mail-oauth";
export * from "./mailboxes";
export * from "./notify";
export * from "./me";
export * from "./newsletters";
export * from "./next-path";
export * from "./onboarding";
export * from "./org-name";
export * from "./operator";
export * from "./organization";
export * from "./password";
export * from "./profile";
export * from "./push";
export * from "./replies";
export * from "./public-content";
export * from "./review";
export * from "./rules";
export * from "./security-log";
export * from "./sender-context";
export * from "./sessions";
export * from "./settings";
export * from "./sso";
export * from "./stats";
export * from "./telegram";
export * from "./terms";
export * from "./trust";
export * from "./two-factor";
export * from "../legal";
export * from "../mail/providers";
export * from "../changelog";
export * from "../site";
export * from "../time";
export * from "../texts/locale";
export { userLocales, userLocaleSchema, type UserLocale } from "../tenancy";
export { rightAnswer, pickedText, pickAnswer, type UndoAnswerKind } from "../digest/answers";
export { categoryEmoji, categoryTag } from "../digest/labels";
export { textTables, type CoreTexts } from "../texts";
export { isLabelCategory, labelCategories, type LabelCategory } from "../digest/callback";
export {
  URGENCY_MAX_ITEMS,
  URGENCY_NUL_MESSAGE,
  urgencyProfileSchema,
  type UrgencyProfile,
} from "../triage/urgency-profile";
export { formatClock, formatDay, localDateTime } from "../digest/local-time";
export { bareAddress, ownAddressKey } from "../triage/payloads";
export { z } from "./zod";
