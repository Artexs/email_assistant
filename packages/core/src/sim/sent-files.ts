import { z } from "zod";

import { sentBlindCaseSchema, sentLabelSchema, sentParts, sentSlotSchema, sentTextSchema } from "./sent-slot";

// The files of the sent bank: `evals/sim/<scenario>/<sent part>/{slots,texts,blind,labels}/batch-NNN.json`.
const head = { scenario: z.string(), part: z.enum(sentParts), batch: z.string() };

export const sentSlotBatchFileSchema = z.object({ ...head, slots: z.array(sentSlotSchema) }).strict();
export type SentSlotBatchFile = z.infer<typeof sentSlotBatchFileSchema>;

export const sentTextBatchFileSchema = z
  .object({ ...head, writer: z.string().min(1).max(80), cases: z.array(sentTextSchema) })
  .strict();
export type SentTextBatchFile = z.infer<typeof sentTextBatchFileSchema>;

export const sentBlindBatchFileSchema = z.object({ ...head, cases: z.array(sentBlindCaseSchema) }).strict();
export type SentBlindBatchFile = z.infer<typeof sentBlindBatchFileSchema>;

export const sentLabelBatchFileSchema = z
  .object({ ...head, checker: z.string().min(1).max(80), labels: z.array(sentLabelSchema) })
  .strict();
export type SentLabelBatchFile = z.infer<typeof sentLabelBatchFileSchema>;
