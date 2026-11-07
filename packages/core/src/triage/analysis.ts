import { z } from "zod";

import { reasonCodes, type Category } from "./categories";

export const TASK_MAX_CHARS = 300;
export const CLARIFICATION_MAX_CHARS = 200;

export function buildTriageAnalysisSchema(allowed: readonly Category[], delegateIds: readonly string[] = []) {
  const delegateId = delegateIds.length > 0 ? z.enum(delegateIds as [string, ...string[]]).nullable() : z.null();
  return z.object({
    category: z.enum(allowed as [Category, ...Category[]]),
    confidence: z.number().min(0).max(1),
    reason_code: z.enum(reasonCodes),
    reason: z.string().max(300),
    summary: z.string().max(600).nullable(),
    fields: z.object({
      due_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable(),
      language: z.enum(["pl", "en", "other"]),
      delegate_id: delegateId,
      task: z.string().max(TASK_MAX_CHARS).nullable(),
      clarification: z.string().max(CLARIFICATION_MAX_CHARS).nullable(),
    }),
  });
}

export type TriageAnalysis = z.infer<ReturnType<typeof buildTriageAnalysisSchema>>;
