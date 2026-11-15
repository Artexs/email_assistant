import type { ExtractorScores, Group } from "./extractor-eval";
import { EXTRACTOR_BARS } from "./extractor-report";

const group: Group = { n: 10, replyRight: 9, promiseRight: 10, dueN: 4, dueExact: 4 };

// Numbers at the bars exactly; a test changes one field.
export function scoresAtBars(): ExtractorScores {
  const confusion = (recallLower: number, precisionLower: number) => ({
    tp: 90,
    fp: 5,
    fn: 5,
    tn: 100,
    recall: 0.95,
    precision: 0.95,
    recallLower,
    precisionLower,
  });
  return {
    cases: 200,
    answered: 200,
    skipped: 4,
    errors: 0,
    skipReasons: { too_many: 4 },
    expectsReply: confusion(EXTRACTOR_BARS.replyRecallLower, EXTRACTOR_BARS.replyPrecisionLower),
    promise: confusion(0.8, EXTRACTOR_BARS.promisePrecisionLower),
    due: { n: 50, exact: 45, share: EXTRACTOR_BARS.dueExact },
    promiseDue: { n: 30, exact: 27, share: 0.9 },
    injection: { n: 20, leaks: 0 },
    labelReplyShare: 0.5,
    predictedReplyShare: 0.48,
    byLang: { en: group, pl: group },
    byTag: { past_date: group },
  };
}
