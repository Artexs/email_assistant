import { DIGEST_TIME_PATTERN } from "../digest/schedule";

import { z } from "./zod";

// F110 stage 18: the own quiet hours and report channel of a member (`GET/PATCH /api/me/notify`).
export const reportChannels = ["telegram", "mail", "both"] as const;
export const reportChannelSchema = z.enum(reportChannels);
export type ReportChannel = z.infer<typeof reportChannelSchema>;

// The longest quiet window: a hold of 18 h plus one retry stays below the 24 h life of an outbox row, so a held urgent notice
// or approval card is never dropped as expired (the daylight-saving change adds at most one hour).
export const QUIET_MAX_SPAN_MIN = 18 * 60;

// The minutes from `start` to `end` on the wall clock, over midnight when `end` is earlier. Equal times mean no quiet hours: 0.
export function quietSpanMin(start: string, end: string): number {
  const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return (minutes(end) - minutes(start) + 24 * 60) % (24 * 60);
}

const timeSchema = z.string().regex(DIGEST_TIME_PATTERN, "time_invalid");

export const notifyViewSchema = z.object({
  // Both null: the default hours of the server (22:00–07:00).
  quietStart: z.string().nullable(),
  quietEnd: z.string().nullable(),
  reportChannel: reportChannelSchema,
  // The mailbox that gets the report mail; null with `telegram`.
  reportMailboxId: z.uuid().nullable(),
  // The active mailboxes of the organization that can get the report mail, oldest first.
  mailboxes: z.array(z.object({ id: z.uuid(), address: z.string() })),
  telegramLinked: z.boolean(),
});
export type NotifyView = z.infer<typeof notifyViewSchema>;

// One body changes one group of keys. Quiet hours: both keys, both a time or both null (reset to the default).
// Channel: `reportChannel` (null resets to `telegram`) and, for `mail` or `both`, an optional mailbox.
export const notifyPatchSchema = z
  .strictObject({
    quietStart: timeSchema.nullable().optional(),
    quietEnd: timeSchema.nullable().optional(),
    reportChannel: reportChannelSchema.nullable().optional(),
    reportMailboxId: z.uuid().nullable().optional(),
  })
  .superRefine((body, ctx) => {
    const quiet = body.quietStart !== undefined || body.quietEnd !== undefined;
    const channel = body.reportChannel !== undefined || body.reportMailboxId !== undefined;
    if (quiet === channel) {
      ctx.addIssue({ code: "custom", message: "notify_one_group" });
      return;
    }
    if (
      quiet &&
      (body.quietStart === undefined ||
        body.quietEnd === undefined ||
        (body.quietStart === null) !== (body.quietEnd === null))
    ) {
      ctx.addIssue({ code: "custom", path: ["quietEnd"], message: "quiet_pair" });
      return;
    }
    if (
      quiet &&
      body.quietStart !== null &&
      body.quietStart !== undefined &&
      body.quietEnd !== null &&
      body.quietEnd !== undefined
    ) {
      if (quietSpanMin(body.quietStart, body.quietEnd) > QUIET_MAX_SPAN_MIN) {
        ctx.addIssue({ code: "custom", path: ["quietEnd"], message: "quiet_too_long" });
      }
      return;
    }
    if (channel && body.reportChannel === undefined) {
      ctx.addIssue({ code: "custom", path: ["reportChannel"], message: "channel_required" });
    }
  });
export type NotifyPatch = z.infer<typeof notifyPatchSchema>;
