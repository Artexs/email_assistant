import { createHash } from "node:crypto";

import { localDateTime } from "../digest/local-time";
import { resolveDue, type DueRef } from "../loops/dates";

import type { Scenario } from "./scenario";
import type { SentBlindCase, SentLabel, SentSlot, SentText } from "./sent-slot";

// The address of a persona or delegate key of a slot; the executive key is the executive.
export function sentAddressOf(scenario: Scenario, key: string): string {
  if (key === scenario.executive.key) return scenario.executive.address;
  const persona = scenario.personas.find((p) => p.key === key);
  if (persona === undefined) throw new Error(`unknown persona key: ${key}`);
  return persona.address;
}

// What the extractor and the blind checker see: the mail as a mail holds it. No label, no slot field.
export function sentBlindOf(slot: SentSlot, text: SentText, scenario: Scenario): SentBlindCase {
  const { executive } = scenario;
  return {
    id: slot.id,
    from: `${executive.displayName} <${executive.address}>`,
    to: slot.to.map((key) => sentAddressOf(scenario, key)),
    cc: slot.cc.map((key) => sentAddressOf(scenario, key)),
    subject: text.subject,
    sentAt: slot.sentAt,
    body: text.body,
    threadSubjects: slot.thread.map((item) => item.subject),
  };
}

// sha256 hex of the JSON of the blind entry: a changed text changes it and makes the label stale.
export function sentBlindHash(entry: SentBlindCase): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

// The slot label in the form of a checker label: a due reference becomes the local day it resolves to.
export interface SentExpected {
  expectsReply: boolean;
  promise: boolean;
  due: string | null;
  promiseDue: string | null;
}

function dayOf(ref: DueRef | null, sentAt: Date, timeZone: string): string | null {
  if (ref === null) return null;
  const due = resolveDue(ref, { sentAt, timeZone });
  return due === null ? null : localDateTime(due, timeZone).date;
}

export function sentExpectedOf(slot: SentSlot, timeZone: string): SentExpected {
  const sentAt = new Date(slot.sentAt);
  const { labels } = slot;
  return {
    expectsReply: labels.expectsReply,
    promise: labels.promise !== null,
    due: dayOf(labels.due, sentAt, timeZone),
    promiseDue: dayOf(labels.promiseDue, sentAt, timeZone),
  };
}

export type SentLabelField = "expectsReply" | "promise" | "due" | "promiseDue";

// The fields in which the checker's label differs from the slot label. An empty list means they agree.
export function sentLabelDisagreements(expected: SentExpected, label: SentLabel): SentLabelField[] {
  const fields: SentLabelField[] = ["expectsReply", "promise", "due", "promiseDue"];
  return fields.filter((field) => expected[field] !== label[field]);
}
