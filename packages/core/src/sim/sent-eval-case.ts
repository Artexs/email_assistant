import type { Scenario } from "./scenario";
import { sentBlindOf, sentExpectedOf, type SentExpected } from "./sent-blind";
import type { SentBlindCase, SentLabels, SentPart, SentSlot, SentText } from "./sent-slot";

// One case for the extractor gate (stage 06): the blind view plus the slot labels.
export interface SentEvalCase {
  id: string;
  part: SentPart;
  lang: SentSlot["lang"];
  hardCases: SentSlot["hardCases"];
  // What the extractor sees.
  blind: SentBlindCase;
  // The slot labels as planned, and the same labels with each due reference resolved to its local day.
  labels: SentLabels;
  expected: SentExpected;
}

// Joins the slot of a written mail with its text. The slot labels are the truth, not the checker's labels.
export function sentEvalCase(slot: SentSlot, text: SentText, scenario: Scenario): SentEvalCase {
  return {
    id: slot.id,
    part: slot.part,
    lang: slot.lang,
    hardCases: slot.hardCases,
    blind: sentBlindOf(slot, text, scenario),
    labels: slot.labels,
    expected: sentExpectedOf(slot, scenario.executive.timeZone),
  };
}
