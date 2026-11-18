import { z } from "zod";

import { dueRefSchema } from "../loops/dates";

import { sentHardCaseRule, sentHardCaseTags } from "./sent-hard-cases";
import { lengthBuckets } from "./slot";

// The parts of the sent-mail bank. `simParts` stays as it is, so the frozen lab-01 manifest does not change.
export const sentParts = ["sent-dev", "sent-holdout"] as const;
export type SentPart = (typeof sentParts)[number];

const dateText = z.iso.date();

// Ground truth of one sent mail, fixed before any text exists.
export const sentLabelsSchema = z
  .object({
    expectsReply: z.boolean(),
    // The English brief of the ask: set if and only if `expectsReply`.
    ask: z.string().min(1).max(80).nullable(),
    due: dueRefSchema.nullable(),
    // The firm promise of the executive; it always has a date (an undated promise opens no loop).
    promise: z.string().min(1).max(80).nullable(),
    promiseDue: dueRefSchema.nullable(),
  })
  .strict();
export type SentLabels = z.infer<typeof sentLabelsSchema>;

export const sentLangs = ["pl", "en"] as const;

type Issue = (path: string, message: string) => void;

// The rules of the labels; `sentLabelSchema` (the checker label) repeats the promise rule.
function labelIssues(labels: SentLabels, issue: Issue): void {
  if ((labels.ask !== null) !== labels.expectsReply) issue("ask", "ask is set if and only if expectsReply");
  if (labels.due !== null && !labels.expectsReply) issue("due", "due needs expectsReply");
  if ((labels.promise !== null) !== (labels.promiseDue !== null)) {
    issue("promiseDue", "promise and promiseDue are set together");
  }
}

export const sentSlotSchema = z
  .object({
    // regular: `s-<nnnn>`, hard case: `sh-<tag short>-<nn>`
    id: z.string().regex(/^(s-\d{4}|sh-[a-z]{2,4}-\d{2})$/),
    part: z.enum(sentParts),
    batch: z.string().regex(/^batch-\d{3}$/),
    // The executive key.
    persona: z.string(),
    to: z.array(z.string()).min(1).max(12),
    cc: z.array(z.string()).max(12).default([]),
    lang: z.enum(sentLangs),
    sentAt: z.iso.datetime(),
    labels: sentLabelsSchema,
    hardCases: z.array(z.enum(sentHardCaseTags)).default([]),
    // Earlier mails of the thread, oldest first.
    thread: z
      .array(
        z.object({ from: z.string(), subject: z.string().min(1).max(200), brief: z.string().min(1).max(200) }).strict()
      )
      .max(3)
      .default([]),
    // The text quotes the last mail of the thread.
    quoted: z.boolean().default(false),
    style: z
      .object({
        length: z.enum(lengthBuckets),
        greeting: z.enum(["formal", "informal", "none"]),
        signature: z.boolean(),
      })
      .strict(),
    // One English brief for the writer, never shown to the checker.
    brief: z.string().min(1).max(300),
  })
  .strict()
  .superRefine((slot, ctx) => {
    const issue: Issue = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
    labelIssues(slot.labels, (path, message) => issue(`labels.${path}`, message));
    const recipients = [...slot.to, ...slot.cc];
    if (new Set(recipients).size !== recipients.length) issue("to", "a recipient appears twice");
    if (recipients.includes(slot.persona)) issue("to", "the executive is no recipient");
    if (slot.quoted && slot.thread.length === 0) issue("quoted", "quoted needs a thread mail");

    for (const tag of slot.hardCases) {
      const { labels, needsThread, needsQuoted, manyRecipients } = sentHardCaseRule(tag);
      if (labels.expectsReply !== undefined && slot.labels.expectsReply !== labels.expectsReply) {
        issue("labels.expectsReply", `${tag} sets expectsReply to ${labels.expectsReply}`);
      }
      if (labels.due === "none" && slot.labels.due !== null) issue("labels.due", `${tag} has no due label`);
      if (labels.due === "word" && slot.labels.due?.kind !== "word") issue("labels.due", `${tag} has a time-word due`);
      if (labels.promise === "none" && slot.labels.promise !== null) {
        issue("labels.promise", `${tag} has no promise label`);
      }
      if (needsThread && slot.thread.length === 0) issue("thread", `${tag} needs a thread mail`);
      if (needsQuoted && !slot.quoted) issue("quoted", `${tag} needs a quoted mail`);
      if (manyRecipients && recipients.length <= 10) issue("to", `${tag} needs more than 10 recipients`);
    }
  });
export type SentSlot = z.infer<typeof sentSlotSchema>;

// What the writer adds to a slot.
export const sentTextSchema = z
  .object({
    id: z.string(),
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n]/.test(s), { message: "the subject has one line" }),
    body: z.string().min(1).max(6000),
    // Injection slots only: the exact strings the quoted third-party text plants.
    planted: z.array(z.string().min(1).max(200)).max(3).optional(),
  })
  .strict();
export type SentText = z.infer<typeof sentTextSchema>;

// What the extractor and the blind checker see: the mail as a mail holds it, with no label and no slot field.
export const sentBlindCaseSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()),
    subject: z.string(),
    sentAt: z.iso.datetime(),
    body: z.string(),
    // The subjects of the earlier mails of the thread, oldest first.
    threadSubjects: z.array(z.string()),
  })
  .strict();
export type SentBlindCase = z.infer<typeof sentBlindCaseSchema>;

// The checker's label of one case. Dates are the resolved local day (YYYY-MM-DD), null when none or dropped.
export const sentLabelSchema = z
  .object({
    id: z.string(),
    expectsReply: z.boolean(),
    promise: z.boolean(),
    due: dateText.nullable(),
    promiseDue: dateText.nullable(),
    // sha256 hex of the JSON of the blind entry at label time; a rewrite makes only that label stale.
    blindHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine((label, ctx) => {
    if (label.promise !== (label.promiseDue !== null)) {
      ctx.addIssue({ code: "custom", path: ["promiseDue"], message: "promise and promiseDue are set together" });
    }
    if (label.due !== null && !label.expectsReply) {
      ctx.addIssue({ code: "custom", path: ["due"], message: "due needs expectsReply" });
    }
  });
export type SentLabel = z.infer<typeof sentLabelSchema>;
