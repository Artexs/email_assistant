import * as classifierV2 from "./classifier-v2";

// `escalation-v1` is the text of the production classifier prompt with no change (F109 D15): the second call is an
// independent classification, so it gets the same input and schema and no word about the first answer.
// A change of the production classifier prompt needs `escalation-v2` and its own gate (`eval-escalation.test.ts` checks that the base equals the classifier version).
export const PROMPT_VERSION = "escalation-v1";

// The classifier prompt version whose builders this version uses.
export const BASE_VERSION = classifierV2.PROMPT_VERSION;

export const buildSystemPrompt = classifierV2.buildSystemPrompt;
export const buildUserPrompt = classifierV2.buildUserPrompt;
