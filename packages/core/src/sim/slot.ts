import { z } from "zod";

import { senderHistorySchema } from "../triage/sender-history";
import { urgencySources } from "../triage/urgency-profile";

import { hardCaseTagIds } from "./hard-cases";
import { simLangs } from "./scenario";

export const valueCategories = ["urgent", "needs_reply", "delegation", "info", "notification", "spam"] as const;
export type ValueCategory = (typeof valueCategories)[number];
export const simParts = ["dev", "holdout", "week"] as const;
export type SimPart = (typeof simParts)[number];
export const lengthBuckets = ["short", "medium", "long"] as const;

// A slot is the ground truth of one mail: the label is fixed here before any text exists.
export const slotSchema = z
  .object({
    // bank: `b-<category short>-<nnnn>`, hard: `h-<tag short>-<nn>`, week: `w-<d>-<nnn>`
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    part: z.enum(simParts),
    batch: z.string().regex(/^batch-\d{3}$/),
    // Sender key; for direction "sent" the executive key.
    persona: z.string(),
    direction: z.enum(["in", "sent"]).default("in"),
    to: z.array(z.string()).min(1),
    cc: z.array(z.string()).default([]),
    lang: z.enum(simLangs),
    receivedAt: z.iso.datetime(),
    category: z.enum(valueCategories),
    urgencySource: z.enum(urgencySources).optional(),
    contextRef: z
      .object({ kind: z.enum(["topic", "deadline"]), index: z.number().int().min(0) })
      .strict()
      .optional(),
    topic: z.string().optional(),
    hardCases: z.array(z.enum(hardCaseTagIds)).default([]),
    kind: z.enum(["synthetic", "injection"]),
    expectedDelegate: z.string().optional(),
    expectedDraft: z.enum(["delegation", "clarification", "none"]).optional(),
    // Week only (E2b).
    delegateBehaviour: z.enum(["done", "late", "out_of_office", "other_address", "silent"]).optional(),
    // Address on the company's reserved domain that replaces the persona address (a bounce comes from mailer-daemon).
    fromOverride: z.string().optional(),
    style: z
      .object({
        length: z.enum(lengthBuckets),
        format: z.enum(["plain", "html"]),
        signature: z.boolean(),
        greeting: z.enum(["formal", "informal", "none"]),
      })
      .strict(),
    headers: z.record(z.string(), z.string()).default({}),
    attachments: z
      .array(z.object({ name: z.string().max(80), mime: z.string(), sizeBytes: z.number().int().positive() }).strict())
      .default([]),
    // Earlier mails of the thread, oldest first (bank).
    thread: z
      .array(z.object({ persona: z.string(), brief: z.string().max(200) }).strict())
      .max(4)
      .default([]),
    // Week threads (stage 08).
    threadId: z.string().optional(),
    parentId: z.string().optional(),
    senderHistory: senderHistorySchema.optional(),
    // One English line for the writer, never shown to the checker.
    brief: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((slot, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if ((slot.category === "urgent") !== (slot.urgencySource !== undefined)) {
      issue("urgencySource", "urgencySource is set if and only if the category is urgent");
    }
    if ((slot.urgencySource === "context") !== (slot.contextRef !== undefined)) {
      issue("contextRef", "contextRef is set if and only if the urgency source is context");
    }
    if ((slot.category === "delegation") !== (slot.expectedDraft !== undefined)) {
      issue("expectedDraft", "expectedDraft is set if and only if the category is delegation");
    }
  });
export type Slot = z.infer<typeof slotSchema>;

export const slotBatchFileSchema = z
  .object({
    scenario: z.string(),
    part: z.enum(simParts),
    batch: z.string(),
    slots: z.array(slotSchema).min(1).max(25),
  })
  .strict();
export type SlotBatchFile = z.infer<typeof slotBatchFileSchema>;
