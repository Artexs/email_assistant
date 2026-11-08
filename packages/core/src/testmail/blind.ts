import { z } from "zod";

import { testmailCategories, type Batch, type PersonaFile, type TestmailCategory } from "./batch";

// What the classifier sees: one bare sender address for every persona, no display name, no group.
export interface BlindCase {
  id: string;
  from: string;
  lang: "pl" | "en";
  subject: string;
  body: string;
  thread: { from: string; subject: string; body: string }[];
}

export function blindView(batch: Batch, personas: PersonaFile): BlindCase[] {
  const from = `${personas.inbox.username}@agentmail.to`;
  const byId = new Map(batch.cases.map((item) => [item.id, item]));
  return batch.cases.map((item) => {
    const thread: BlindCase["thread"] = [];
    const seen = new Set<string>([item.id]);
    let parent = item.replyTo ? byId.get(item.replyTo) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      thread.unshift({ from, subject: parent.subject, body: parent.body });
      parent = parent.replyTo ? byId.get(parent.replyTo) : undefined;
    }
    return { id: item.id, from, lang: item.lang, subject: item.subject, body: item.body, thread };
  });
}

export const blindLabelsSchema = z
  .array(z.object({ id: z.string(), category: z.enum(testmailCategories) }).strict())
  .superRefine((labels, ctx) => {
    const seen = new Set<string>();
    labels.forEach((label, index) => {
      if (seen.has(label.id)) {
        ctx.addIssue({ code: "custom", path: [index, "id"], message: "label id not unique" });
      }
      seen.add(label.id);
    });
  });

export function applyBlindLabels(
  batch: Batch,
  labels: { id: string; category: TestmailCategory }[],
  checker: string
): { batch: Batch; unknownIds: string[]; missingIds: string[] } {
  const byId = new Map(labels.map((label) => [label.id, label.category]));
  const caseIds = new Set(batch.cases.map((item) => item.id));
  const unknownIds = labels.map((label) => label.id).filter((id) => !caseIds.has(id));
  const missingIds: string[] = [];
  const cases = batch.cases.map((item) => {
    const category = byId.get(item.id);
    if (category === undefined) {
      missingIds.push(item.id);
      return structuredClone(item);
    }
    return { ...structuredClone(item), blind: { category } };
  });
  return { batch: { ...batch, checker, cases }, unknownIds, missingIds };
}
