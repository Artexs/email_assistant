import { z } from "zod";

import { reasonCodes, type Category } from "./categories";

export function buildTriageAnalysisSchema(allowed: readonly Category[]) {
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
    }),
  });
}

export type TriageAnalysis = z.infer<ReturnType<typeof buildTriageAnalysisSchema>>;
