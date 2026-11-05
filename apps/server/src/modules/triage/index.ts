export { classifyEmail } from "./classifier";
export type { ClassifierEmail, SenderContext } from "./classifier";
export {
  insertFeedback,
  insertTriageResult,
  latestTriageResult,
  listLabeledResults,
  listUnlabeled,
  listUsageSince,
} from "./repo";
export type {
  FeedbackInput,
  LabeledResult,
  LatestTriageResult,
  MailKind,
  TriageResultInput,
  UnlabeledResult,
  UsageRow,
} from "./repo";
export { runEval, toClassifierInput } from "./eval";
export type { CaseResult, CasesEvalReport, EvalReport, EvalReportBase, RealEvalReport } from "./eval";
export { evalExitCode, renderEvalReport } from "./eval-report";
