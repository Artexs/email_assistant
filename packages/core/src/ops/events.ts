import type { SendLimitKind } from "../send-limits";

// The facts of one event that the operator hears about once. Ids, codes, dates and counts only.
export type OperatorEvent =
  | { kind: "trial_ending"; orgId: string; endsAt: Date; ended: boolean }
  | { kind: "auth_error_24h"; orgId: string; mailboxId: string; since: Date }
  | { kind: "llm_cap"; orgId: string; mailboxId: string; cap: number; dayStart: Date }
  | {
      kind: "auth_mail_failed";
      orgId: string;
      userId: string;
      mail: "invite" | "reset" | "lockout";
      code: string;
      at: Date;
    }
  | { kind: "send_limit"; orgId: string; mailboxId: string; limit: SendLimitKind; at: Date; until: Date };

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

// The dedup key of an event. The format is stored in audit rows (`operator.notice`): a changed format sends every past notice again.
export function operatorEventKey(event: OperatorEvent): string {
  switch (event.kind) {
    case "trial_ending":
      return `trial_ending:${event.orgId}:${event.endsAt.getTime()}`;
    case "auth_error_24h":
      return `auth_error_24h:${event.mailboxId}:${event.since.getTime()}`;
    case "llm_cap":
      return `llm_cap:${event.mailboxId}:${event.dayStart.toISOString()}`;
    case "auth_mail_failed":
      return `auth_mail_failed:${event.userId}:${event.code}:${utcDay(event.at)}`;
    case "send_limit":
      return `send_limit:${event.mailboxId}:${utcDay(event.at)}`;
  }
}
