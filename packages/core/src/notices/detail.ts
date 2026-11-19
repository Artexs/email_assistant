import type { NoticeDetail } from "./kinds";

// The detail level of a Telegram message of one member, as the sender uses it at send time (the stored level of the row is the level
// of the last send, never an input). Flag `telegram_minimal` off: `full` (the messages of before the setting). Flag on: an organization
// that locked `minimal` gets `minimal`; else the member's own level.
export function effectiveDetail(input: { flagOn: boolean; locked: boolean; memberDetail: NoticeDetail }): NoticeDetail {
  if (!input.flagOn) return "full";
  return input.locked ? "minimal" : input.memberDetail;
}
