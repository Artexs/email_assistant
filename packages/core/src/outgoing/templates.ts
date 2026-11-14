import type { DraftKind } from "../triage/payloads";

export interface TemplateFields {
  task?: string;
  question?: string;
  dueDate: string | null;
  senderLabel: string;
  dateLabel: string;
  signature: string;
}

type Language = "pl" | "en";
type TemplateText = Required<TemplateFields>;

// One body per draft kind. A new kind fails typecheck here until it has its text.
export const DRAFT_TEMPLATES: Readonly<Record<DraftKind, (pl: boolean, fields: TemplateText) => string>> = {
  delegation: (pl, { task, dueDate, senderLabel, dateLabel, signature }) => {
    const due = dueDate === null ? "" : pl ? `Termin: ${dueDate}\n` : `Due: ${dueDate}\n`;
    return pl
      ? `Dzień dobry,\n\nprzekazuję do realizacji: ${task}\n${due}Oryginalna wiadomość od ${senderLabel} z ${dateLabel} jest poniżej.\n\n${signature}`
      : `Hello,\n\nplease take care of this: ${task}\n${due}The original message from ${senderLabel} of ${dateLabel} is below.\n\n${signature}`;
  },
  clarification: (pl, { question, signature }) =>
    pl
      ? `Dzień dobry,\n\ndziękuję za wiadomość. Zanim przekażę sprawę dalej, potrzebuję jeszcze jednej informacji: ${question}\n\n${signature}`
      : `Hello,\n\nthank you for your message. Before I can hand it on, I need one more thing: ${question}\n\n${signature}`,
  reminder: (pl, { task, dueDate, signature }) => {
    const due = dueDate === null ? "" : pl ? `Termin minął: ${dueDate}.\n` : `The due date ${dueDate} has passed.\n`;
    return pl
      ? `Dzień dobry,\n\nprzypominam o zadaniu: ${task}\n${due}Proszę o krótką informację o stanie prac.\n\n${signature}`
      : `Hello,\n\na reminder about this task: ${task}\n${due}Please send a short status.\n\n${signature}`;
  },
};

export function renderTemplate(kind: DraftKind, language: Language, fields: TemplateFields): string {
  const { task = "", question = "", ...rest } = fields;
  return DRAFT_TEMPLATES[kind](language === "pl", { ...rest, task, question });
}
