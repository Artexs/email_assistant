import { z } from "zod";

// The plan of one corpus: seed and bank sizes. The planner (stage 07) reads it; the file is evals/sim/<id>/plan.json.
export const planSpecSchema = z
  .object({
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
    batchSize: z.literal(25),
    bank: z
      .object({
        devPerCategory: z.number().int().positive(),
        holdoutPerCategory: z.number().int().positive(),
        hardPerTag: z.number().int().positive(),
        hardDevPerTag: z.number().int().min(0),
        replyInjectionPerTag: z.number().int().positive(),
        replyInjectionDevPerTag: z.number().int().min(0),
        langShare: z.object({ pl: z.number(), en: z.number() }).strict(),
        threadShare: z.number().min(0).max(1),
      })
      .strict(),
    // Stage 08 replaces this placeholder with the week plan.
    week: z.object({}).strict().optional(),
  })
  .strict();
export type PlanSpec = z.infer<typeof planSpecSchema>;
