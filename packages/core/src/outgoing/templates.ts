import { textTables } from "../texts";
import type { DraftKind } from "../triage/payloads";

export interface TemplateFields {
  task?: string;
  question?: string;
  dueDate: string | null;
  // The follow-up only: the subject of the own mail, the day of it and the number of this follow-up.
  subject?: string;
  followUpNumber?: 1 | 2;
  senderLabel: string;
  dateLabel: string;
  signature: string;
}

type Language = "pl" | "en";
type TemplateText = Required<TemplateFields>;

// A kind whose body is not a template. The reason says where the body comes from. `draft-kinds.test.ts` holds the two lists
// together: every kind is in exactly one of them.
export const NO_TEMPLATE = {
  reply:
    "the body is the text in the payload (`body_text ?? body`); the signature and the quote are added by `buildOutgoingMessage`",
} as const satisfies Partial<Record<DraftKind, string>>;
export type TemplatedKind = Exclude<DraftKind, keyof typeof NO_TEMPLATE>;

// One body per draft kind. A new kind fails typecheck here until it has its text, or a reason in `NO_TEMPLATE`.
export const DRAFT_TEMPLATES: Readonly<Record<TemplatedKind, (pl: boolean, fields: TemplateText) => string>> = {
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
  // `dateLabel` is the day of the own mail (`formatSentDate`).
  follow_up: (pl, { subject, dateLabel, followUpNumber, signature }) => {
    const texts = textTables[pl ? "pl" : "en"].followUp;
    const body = followUpNumber === 2 ? texts.second(dateLabel, subject) : texts.first(dateLabel, subject);
    return `${body}\n\n${signature}`;
  },
};

export function renderTemplate(kind: TemplatedKind, language: Language, fields: TemplateFields): string {
  const { task = "", question = "", subject = "", followUpNumber = 1, ...rest } = fields;
  return DRAFT_TEMPLATES[kind](language === "pl", { ...rest, task, question, subject, followUpNumber });
}
