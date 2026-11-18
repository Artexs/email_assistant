import { DIGEST_TIME_PATTERN } from "../digest/schedule";
import { noticeRoutesPatchSchema, noticeRoutesSchema } from "../notices/routes";

import { z } from "./zod";

// The own quiet hours, report channel and notice routes of a member (`GET/PATCH /api/me/notify`).
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
  // The stored choice per notice group (a missing key: the user chose none). The routes need the flag `web_push`.
  routes: noticeRoutesSchema,
  // Where a notice of each group goes now with no stored choice, for the chat and the live push devices of the member
  // (`effectiveRoute`). The panel shows it as the default of a group.
  routeDefaults: z.strictObject({
    urgent: z.strictObject({ telegram: z.boolean(), push: z.boolean() }),
    approvals: z.strictObject({ telegram: z.boolean(), push: z.boolean() }),
    updates: z.strictObject({ telegram: z.boolean(), push: z.boolean() }),
  }),
});
export type NotifyView = z.infer<typeof notifyViewSchema>;

// One body changes one group of keys. Quiet hours: both keys, both a time or both null (reset to the default).
// Channel: `reportChannel` (null resets to `telegram`) and, for `mail` or `both`, an optional mailbox.
// Routes: `routes` alone; a key that is not in the body keeps its stored value, `null` removes the key.
export const notifyPatchSchema = z
  .strictObject({
    quietStart: timeSchema.nullable().optional(),
    quietEnd: timeSchema.nullable().optional(),
    reportChannel: reportChannelSchema.nullable().optional(),
    reportMailboxId: z.uuid().nullable().optional(),
    routes: noticeRoutesPatchSchema.optional(),
  })
  .superRefine((body, ctx) => {
    const quiet = body.quietStart !== undefined || body.quietEnd !== undefined;
    const channel = body.reportChannel !== undefined || body.reportMailboxId !== undefined;
    const routes = body.routes !== undefined;
    if ([quiet, channel, routes].filter(Boolean).length !== 1) {
      ctx.addIssue({ code: "custom", message: "notify_one_group" });
      return;
    }
    if (routes) return;
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
