import { z } from "zod";

import { simParts, valueCategories } from "./slot";

// What the writer adds to a slot: the text of one mail and the facts that depend on the text.
export const caseTextSchema = z
  .object({
    id: z.string(),
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s), { message: "the subject has one line" }),
    // "" only for an html_only slot.
    body: z.string().max(6000),
    // Set if and only if the slot format is html.
    html: z.string().max(20000).optional(),
    // One entry per slot thread item, oldest first.
    thread: z.array(z.object({ subject: z.string().max(200), body: z.string().max(3000) }).strict()).default([]),
    // needs_reply slots only.
    expectedPoints: z.array(z.string().min(1).max(160)).max(5).optional(),
    mustNot: z.array(z.string().min(1).max(160)).max(3).optional(),
    // Injection slots only: the exact strings the attack tries to get into a draft.
    planted: z.array(z.string().min(1).max(200)).max(3).optional(),
    // "borderline: <reason>" or "rewritten: <reason>".
    note: z.string().max(300).optional(),
    // Two blind disagreements drop a bank case.
    dropped: z.literal(true).optional(),
  })
  .strict();
export type CaseText = z.infer<typeof caseTextSchema>;

export const textBatchFileSchema = z
  .object({
    scenario: z.string(),
    part: z.enum(simParts),
    batch: z.string(),
    writer: z.string().min(1).max(80),
    cases: z.array(caseTextSchema),
  })
  .strict();
export type SimTextBatchFile = z.infer<typeof textBatchFileSchema>;

// What the blind checker sees: the mail as a mail holds it, with no slot field.
export const blindCaseSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()),
    subject: z.string(),
    body: z.string(),
    thread: z.array(z.object({ from: z.string(), subject: z.string(), body: z.string() }).strict()),
    attachments: z.array(z.string()),
  })
  .strict();
export type SimBlindCase = z.infer<typeof blindCaseSchema>;

export const blindBatchFileSchema = z
  .object({ scenario: z.string(), part: z.enum(simParts), batch: z.string(), cases: z.array(blindCaseSchema) })
  .strict();
export type SimBlindBatchFile = z.infer<typeof blindBatchFileSchema>;

export const labelBatchFileSchema = z
  .object({
    scenario: z.string(),
    part: z.enum(simParts),
    batch: z.string(),
    checker: z.string().min(1).max(80),
    // blindHash is the sha256 hex of the JSON of the blind entry at label time; a rewrite makes only that label stale.
    labels: z.array(
      z
        .object({
          id: z.string(),
          category: z.enum(valueCategories),
          blindHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict()
    ),
  })
  .strict();
export type SimLabelBatchFile = z.infer<typeof labelBatchFileSchema>;
