import { z } from "zod";

const share = z.number().min(0).max(1);

// The week of mail the planner builds (stage 08): counts per day, the mix and the thread, delegate and history shapes.
export const weekSpecSchema = z
  .object({
    weekdayMails: z.number().int().positive(),
    weekendMails: z.number().int().min(0),
    mix: z
      .object({
        notification: share,
        spam: share,
        info: share,
        needs_reply: share,
        delegation: share,
        urgent: share,
      })
      .strict()
      .refine((mix) => Math.abs(Object.values(mix).reduce((a, b) => a + b, 0) - 1) <= 1e-9, {
        message: "the mix shares add up to 1",
      }),
    langShare: z.object({ pl: z.number(), en: z.number() }).strict(),
    // Share of the person mail that replies to an earlier mail of the week.
    replyShare: share,
    maxThreadDepth: z.number().int().min(1).max(10),
    sentThreadsPerWeekday: z.number().int().min(0),
    offHoursShare: share,
    behaviour: z
      .object({
        done: z.number(),
        late: z.number(),
        out_of_office: z.number(),
        other_address: z.number(),
        silent: z.number(),
      })
      .strict(),
    historyDays: z.number().int().positive(),
  })
  .strict();
export type WeekSpec = z.infer<typeof weekSpecSchema>;

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
    week: weekSpecSchema,
  })
  .strict();
export type PlanSpec = z.infer<typeof planSpecSchema>;
