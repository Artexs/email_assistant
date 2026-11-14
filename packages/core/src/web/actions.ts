import { rejectReasons } from "../metrics/m3";

import { z } from "./zod";

// POST /api/actions/:id/reject-reason (F100 D21): the owner names the reason of a rejected send.
export const rejectReasonBodySchema = z.object({ reason: z.enum(rejectReasons) });
export type RejectReasonBody = z.infer<typeof rejectReasonBodySchema>;

// The answer of both action routes: `saved` for a new write, `already` for a mistake that was marked before.
export interface ActionFeedbackAnswer {
  status: "saved" | "already";
}
