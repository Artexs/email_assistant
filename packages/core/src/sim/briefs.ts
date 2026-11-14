import type { UrgencySource } from "../triage/urgency-profile";

import type { Rng } from "./random";
import type { ValueCategory } from "./slot";

export const BRIEF_MAX = 200;

export interface BriefFacts {
  category: ValueCategory;
  urgencySource?: UrgencySource;
  // The topic label, or the label of the profile topic or deadline for a context source.
  label: string;
  // For a deadline reference: the due date (YYYY-MM-DD).
  due?: string;
  senderName: string;
  // The task area of the delegate (delegation).
  tag?: string;
}

type Template = (facts: BriefFacts) => string;

// A brief never names the category ("urgent", "spam"), so the writer is not told what words to use.
const templates: Record<string, readonly Template[]> = {
  "urgent:text": [
    (f) => `about ${f.label}: the sender needs the executive to act today and says so plainly`,
    (f) => `${f.senderName} writes about ${f.label}; a decision is due today and the text makes that clear`,
  ],
  "urgent:vip": [
    (f) => `a short request about ${f.label} from an important person; no deadline words`,
    (f) => `${f.senderName} asks the executive for something about ${f.label}; the tone is calm`,
  ],
  "urgent:context": [
    (f) => `about ${f.label}${f.due ? ` (due ${f.due})` : ""}, needs action today, does not say how pressing it is`,
    (f) =>
      `${f.senderName} writes about ${f.label}${f.due ? ` (due ${f.due})` : ""}; action is needed today, but the text stays plain`,
  ],
  needs_reply: [
    (f) => `asks the executive a direct question about ${f.label} and waits for an answer`,
    (f) => `${f.senderName} wants the executive's view on ${f.label} and asks for a written answer`,
  ],
  delegation: [
    (f) => `a task in ${f.tag ?? "the team"}: asks the executive to have ${f.label} handled by the team`,
    (f) => `a task in ${f.tag ?? "the team"}: ${f.senderName} wants someone to take care of ${f.label}`,
  ],
  info: [
    (f) => `shares plain information about ${f.label}; no question and no request`,
    (f) => `${f.senderName} reports a status on ${f.label} for the executive's awareness`,
  ],
  notification: [
    (f) => `an automated message from ${f.senderName} about ${f.label}; no person writes it`,
    (f) => `a system message about ${f.label}, sent by ${f.senderName}, with no personal text`,
  ],
  spam: [
    (f) => `an unsolicited promo from ${f.senderName} that offers something unrelated to the executive's work`,
    (f) => `${f.senderName} pushes a discount or an offer that nobody asked for`,
  ],
};

function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

// The brief of a bank slot: English, at most 200 characters.
export function briefFor(rng: Rng, facts: BriefFacts): string {
  const key = facts.category === "urgent" ? `urgent:${facts.urgencySource ?? "text"}` : facts.category;
  const choices = templates[key] as readonly Template[];
  const brief = (rng.pick(choices) as Template)({
    ...facts,
    label: cut(facts.label, 60),
    senderName: cut(facts.senderName, 40),
    ...(facts.tag === undefined ? {} : { tag: cut(facts.tag, 30) }),
  });
  return cut(brief, BRIEF_MAX);
}

// The one-line brief of an earlier mail of a thread.
export function threadBriefFor(rng: Rng, label: string, fromExecutive: boolean): string {
  const topic = cut(label, 60);
  const choices = fromExecutive
    ? [`the executive's earlier answer about ${topic}`, `a short earlier note of the executive about ${topic}`]
    : [`an earlier message of the exchange about ${topic}`, `the first mail of the exchange about ${topic}`];
  return rng.pick(choices);
}
