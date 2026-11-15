import type { CaseText } from "../files";
import type { Scenario } from "../scenario";
import type { Slot } from "../slot";

import { shiftDatesInText } from "./date-shift";
import type { LiveRunPlan } from "./run-plan";

// One frozen-week slot and its text become one message. The Message-ID `<slotId.runId@sender-domain>` lets the
// injector, the bots and the scorer find the slot again from the mail alone.
const LAB_ID = /^(w-\d-\d{3})\.((?:day|week)-\d{8}-[0-9a-f]{4})@[^<>@\s]+$/;

export interface LabAddress {
  name: string;
  address: string;
}

export interface LabMessage {
  kind: "smtp" | "append_sent";
  messageId: string;
  from: LabAddress;
  to: string[];
  cc: string[];
  subject: string;
  date: string; // UTC ISO, the `at` of the plan item
  text?: string;
  html?: string;
  inReplyTo?: string;
  references: string[];
  headers: Record<string, string>;
}

export interface ToLabMessageInput {
  slot: Slot;
  text: CaseText;
  scenario: Scenario;
  plan: LiveRunPlan;
  mailbox: string; // the address of the run's mailbox: the executive key becomes this address
  parents: Slot[]; // the thread chain from the root to the direct parent
}

export function labMessageId(slotId: string, runId: string, domain: string): string {
  return `<${slotId}.${runId}@${domain}>`;
}

/** The slot and the run of a lab Message-ID, with or without angle brackets; null for any other id (a bot reply, a foreign mail). */
export function parseLabMessageId(raw: string): { slotId: string; runId: string } | null {
  const trimmed = raw.trim();
  const bracketed = trimmed.startsWith("<") && trimmed.endsWith(">");
  if (trimmed.startsWith("<") !== trimmed.endsWith(">")) return null;
  const match = LAB_ID.exec(bracketed ? trimmed.slice(1, -1) : trimmed);
  if (!match) return null;
  return { slotId: match[1] as string, runId: match[2] as string };
}

function addressOf(key: string, scenario: Scenario, mailbox: string): LabAddress {
  if (key === scenario.executive.key) return { name: scenario.executive.displayName, address: mailbox };
  const persona = scenario.personas.find((candidate) => candidate.key === key);
  if (!persona) throw new Error(`Unknown persona key ${key}`);
  return { name: persona.displayName, address: persona.address };
}

// The sender of a slot: `fromOverride` replaces the persona address; the executive key is the run's mailbox.
function senderOf(slot: Slot, scenario: Scenario, mailbox: string): LabAddress {
  const base = addressOf(slot.persona, scenario, mailbox);
  return slot.fromOverride === undefined ? base : { name: base.name, address: slot.fromOverride };
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

function idOf(slot: Slot, plan: LiveRunPlan, scenario: Scenario, mailbox: string): string {
  return labMessageId(slot.id, plan.runId, domainOf(senderOf(slot, scenario, mailbox).address));
}

export function toLabMessage(input: ToLabMessageInput): LabMessage {
  const { slot, text, scenario, plan, mailbox, parents } = input;
  const item = plan.items.find((candidate) => candidate.slotId === slot.id);
  if (!item) throw new Error(`Slot ${slot.id} is not in run ${plan.runId}`);

  const anchor = scenario.calendar.weekStart;
  const shift = (value: string): string => shiftDatesInText(value, plan.offsetDays, anchor).text;
  const references = parents.map((parent) => idOf(parent, plan, scenario, mailbox));
  const sent = slot.direction === "sent";
  const htmlOnly = slot.hardCases.includes("html_only");

  const message: LabMessage = {
    kind: sent ? "append_sent" : "smtp",
    messageId: idOf(slot, plan, scenario, mailbox),
    from: senderOf(slot, scenario, mailbox),
    to: slot.to.map((key) => addressOf(key, scenario, mailbox).address),
    cc: slot.cc.map((key) => addressOf(key, scenario, mailbox).address),
    subject: shift(text.subject),
    date: item.at,
    references,
    headers: { ...slot.headers },
  };
  if (!htmlOnly) message.text = shift(text.body);
  if (text.html !== undefined) message.html = shift(text.html);
  const parentId = references.at(-1);
  if (parentId !== undefined) message.inReplyTo = parentId;
  return message;
}
