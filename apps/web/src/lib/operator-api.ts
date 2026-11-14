import {
  operatorFlagResultSchema,
  operatorPlanResultSchema,
  type OperatorFlagBody,
  type OperatorFlagResult,
  type OperatorPlanBody,
  type OperatorPlanResult,
} from "@ea/core/web";

import { t, type TextKey } from "../i18n";

import { api, ApiError } from "./api";

export function changePlan(orgId: string, body: OperatorPlanBody): Promise<OperatorPlanResult> {
  return api(`/api/operator/orgs/${orgId}/plan`, operatorPlanResultSchema, { method: "POST", body });
}

export function changeFlag(orgId: string, body: OperatorFlagBody): Promise<OperatorFlagResult> {
  return api(`/api/operator/orgs/${orgId}/flags`, operatorFlagResultSchema, { method: "POST", body });
}

// The server's `error` code is `ApiError.code`. org_suspended, bad_origin and unknown codes read as the generic error.
const errorTexts: Record<string, TextKey> = {
  trial_days_needed: "op_err_trial_days_needed",
  trial_days_without_trial: "op_err_trial_days_without_trial",
  nothing_to_change: "op_err_nothing_to_change",
  trial_days_range: "op_err_trial_days_range",
  max_mailboxes_range: "op_err_max_mailboxes_range",
  unknown_flag: "op_err_unknown_flag",
  not_found: "op_not_found",
  validation: "op_err_validation",
};

export function writeErrorKey(error: unknown): TextKey {
  if (!(error instanceof ApiError)) return "error_generic";
  return Object.hasOwn(errorTexts, error.code) ? (errorTexts[error.code] ?? "error_generic") : "error_generic";
}

const planTexts: Record<OperatorPlanResult["plan"], TextKey> = {
  trial: "op_plan_trial",
  active: "op_plan_active",
  suspended: "op_plan_suspended",
};

export function planChangeText(result: OperatorPlanResult): string {
  if (result.result === "unchanged") return t("op_plan_unchanged");
  const parts = [t("op_plan_changed", { plan: t(planTexts[result.plan]) })];
  if (result.cancelledMessages > 0) parts.push(t("op_plan_cancelled", { count: result.cancelledMessages }));
  if (result.expiredSends > 0) parts.push(t("op_plan_expired", { count: result.expiredSends }));
  return parts.join(" ");
}

export interface PlanForm {
  plan: OperatorPlanResult["plan"];
  trialDays: string;
  maxMailboxes: string;
}

// The body with only the fields that differ from the current state; null when nothing differs.
// A trial day count counts only for the plan `trial`. A value that is not a whole number goes out as it is: the server answers with a range error.
export function planBodyOf(
  current: { plan: OperatorPlanResult["plan"]; maxMailboxes: number },
  form: PlanForm
): OperatorPlanBody | null {
  const body: OperatorPlanBody = {};
  if (form.plan !== current.plan) body.plan = form.plan;
  if (form.plan === "trial" && form.trialDays.trim() !== "") body.trialDays = Number(form.trialDays);
  if (form.maxMailboxes.trim() !== "" && Number(form.maxMailboxes) !== current.maxMailboxes) {
    body.maxMailboxes = Number(form.maxMailboxes);
  }
  return Object.keys(body).length === 0 ? null : body;
}
