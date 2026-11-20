import { assessSuspicious, type EvalCase, EVAL_RECEIVED_AT, localDateTime, type Scenario } from "@ea/core";

import { type ClassifierExtras, deadlinesInWindow, suspiciousInputOfCase, typeOfName } from "../../modules/triage";

// The `ClassifierExtras` of a sim case. The sim history is the persona group's generated mix, so only
// `received` and `corrections` pass for `history`; the whole story passes for `profile` (the counts, the relation and the
// signals of the persona group). `byCategory` never passes for `history`.
const MAX_ATTACHMENTS = 10;

export function classifierExtrasOfCase(evalCase: EvalCase, scenario: Scenario, html?: string | null): ClassifierExtras {
  const input = suspiciousInputOfCase(evalCase, scenario, html);
  const flagged = assessSuspicious(input).length > 0;
  const sim = evalCase.sim;
  const history = sim?.senderHistory;
  const profile = sim?.urgencyProfile;
  const receivedAt = evalCase.receivedAt === undefined ? EVAL_RECEIVED_AT : new Date(evalCase.receivedAt);
  const today = localDateTime(receivedAt, scenario.executive.timeZone).date;
  return {
    attachments: (sim?.attachments ?? [])
      .slice(0, MAX_ATTACHMENTS)
      .map((item) => ({ name: item.name, type: typeOfName(item.name), size: null })),
    isList: input.isList,
    // A flagged mail gets no history and no profile: a forged address must not inherit a good one.
    senderHistory:
      flagged || history === undefined
        ? null
        : { days: history.days, received: history.received, corrections: history.corrections },
    senderProfile: flagged || history === undefined ? null : history,
    urgency:
      profile === undefined
        ? null
        : { today, topics: profile.topics, deadlines: deadlinesInWindow(today, profile.deadlines) },
  };
}
