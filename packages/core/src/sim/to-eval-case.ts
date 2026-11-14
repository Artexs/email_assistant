import { type EvalCase, evalCaseSchema } from "../triage/eval-case";

import type { CaseText } from "./files";
import { isHtmlOnly } from "./hard-cases";
import type { Scenario } from "./scenario";
import type { Slot } from "./slot";

const HOUR_MS = 3_600_000;
const MAX_PARENTS = 3;

export interface HtmlBodyInput {
  subject: string;
  html: string;
  from: string;
  to: string[];
  date: Date;
}

export interface ToEvalCaseDeps {
  // The text the pipeline reads from an html-only mail (the script renders the mail and reads it back).
  htmlBodyText(input: HtmlBodyInput): Promise<string | null>;
}

export interface ToEvalCaseInput {
  slot: Slot;
  text: CaseText;
  scenario: Scenario;
  corpusVersion: string;
  // Week replies: the parent chain, oldest first, at most 3.
  parents?: readonly { slot: Slot; text: CaseText }[];
}

interface Party {
  displayName: string;
  address: string;
}

function partyOf(scenario: Scenario, key: string): Party {
  if (key === scenario.executive.key) return scenario.executive;
  const persona = scenario.personas.find((p) => p.key === key);
  if (persona === undefined) throw new Error(`unknown persona key: ${key}`);
  return persona;
}

function senderAddress(slot: Slot, scenario: Scenario): string {
  return slot.fromOverride ?? partyOf(scenario, slot.persona).address;
}

// The text part wins; only an html-only text falls back to the html as the pipeline reads it.
async function bodyOf(slot: Slot, text: CaseText, scenario: Scenario, deps: ToEvalCaseDeps): Promise<string> {
  if (text.body !== "") return text.body;
  const html = await deps.htmlBodyText({
    subject: text.subject,
    html: text.html ?? "",
    from: `${partyOf(scenario, slot.persona).displayName} <${senderAddress(slot, scenario)}>`,
    to: slot.to.map((key) => partyOf(scenario, key).address),
    date: new Date(slot.receivedAt),
  });
  return html ?? "";
}

type ThreadItem = EvalCase["thread"][number];

async function threadOf(input: ToEvalCaseInput, deps: ToEvalCaseDeps): Promise<ThreadItem[]> {
  const { slot, text, scenario, parents } = input;
  const at = new Date(slot.receivedAt).getTime();
  if (parents !== undefined && parents.length > 0) {
    const chain = parents.slice(-MAX_PARENTS);
    return Promise.all(
      chain.map(async (parent) => ({
        from: senderAddress(parent.slot, scenario),
        subject: parent.text.subject,
        body: isHtmlOnly(parent.slot) ? await bodyOf(parent.slot, parent.text, scenario, deps) : parent.text.body,
        receivedAt: parent.slot.receivedAt,
      }))
    );
  }
  const n = slot.thread.length;
  return slot.thread.map((item, i) => ({
    from: partyOf(scenario, item.persona).address,
    subject: text.thread[i]?.subject ?? "",
    body: text.thread[i]?.body ?? "",
    receivedAt: new Date(at - (n - i) * HOUR_MS).toISOString(),
  }));
}

// Joins one slot with its text into an eval case the runner can classify.
export async function toEvalCase(input: ToEvalCaseInput, deps: ToEvalCaseDeps): Promise<EvalCase> {
  const { slot, text, scenario } = input;
  const sender = partyOf(scenario, slot.persona);
  const delegates = scenario.delegates.map((d) => {
    const persona = partyOf(scenario, d.persona);
    return { key: d.persona, name: persona.displayName, tags: d.tags };
  });
  return evalCaseSchema.parse({
    id: slot.id,
    kind: slot.kind,
    lang: slot.lang,
    from: `${sender.displayName} <${senderAddress(slot, scenario)}>`,
    to: slot.to.map((key) => partyOf(scenario, key).address),
    cc: slot.cc.map((key) => partyOf(scenario, key).address),
    subject: text.subject,
    body: await bodyOf(slot, text, scenario, deps),
    receivedAt: slot.receivedAt,
    thread: await threadOf(input, deps),
    senderRules: scenario.urgency.vip.map((key) => ({ pattern: partyOf(scenario, key).address, kind: "vip" })),
    delegates,
    expected: { category: slot.category, delegate: slot.expectedDelegate, draft: slot.expectedDraft },
    sim: {
      corpus: scenario.id,
      version: input.corpusVersion,
      part: slot.part,
      slotId: slot.id,
      urgencySource: slot.urgencySource,
      hardCases: slot.hardCases,
      senderHistory: slot.senderHistory,
      urgencyProfile: scenario.urgency.profile,
      headers: slot.headers,
      attachments: slot.attachments,
      expectedPoints: text.expectedPoints,
      mustNot: text.mustNot,
      planted: text.planted,
    },
  });
}
