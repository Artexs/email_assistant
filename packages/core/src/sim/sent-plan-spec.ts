import { z } from "zod";

const share = z.number().min(0).max(1);

// The plan of the sent-mail bank: the file is evals/sim/<id>/sent-plan-spec.json.
// The incoming bank has its own plan file; this one does not touch it.
export const sentPlanSpecSchema = z
  .object({
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1),
    batchSize: z.literal(25),
    // Slots per part, hard-case slots included.
    sizes: z.object({ dev: z.number().int().positive(), holdout: z.number().int().positive() }).strict(),
    // Slots per hard-case tag and part.
    hardPerTag: z.object({ dev: z.number().int().min(1), holdout: z.number().int().min(1) }).strict(),
    langShare: z.object({ pl: z.number(), en: z.number() }).strict(),
    expectsReplyShare: share,
    // Slots with a dated promise.
    promiseShare: share,
    // Share of the `expectsReply` slots with a stated due date.
    dueShare: share,
    // Share of the `expectsReply` slots with a delegate as first recipient. At least 15%.
    delegateShare: share.min(0.15),
    weekendShare: share,
    threadShare: share,
    ccShare: share,
  })
  .strict();
export type SentPlanSpec = z.infer<typeof sentPlanSpecSchema>;
