// The CLI line of a failed eval case. The issue paths (`fields.task:too_big`, no model text) are only here: the log
// line `eval_case_failed` or `eval_escalation_failed` holds the case id and the code (a comma list is no log value).
export function evalFailureLine(failure: {
  caseId: string;
  code: string;
  issues: readonly string[];
  stage: "classifier" | "escalation";
}): string {
  const what = failure.stage === "escalation" ? "escalation failed" : "failed";
  const paths = failure.issues.length > 0 ? ` (${failure.issues.join(", ")})` : "";
  return `case ${failure.caseId} ${what}: ${failure.code}${paths}`;
}
