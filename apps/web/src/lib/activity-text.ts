import type { ActivityItem, Category, FeedbackResult, UndoWebResult } from "@ea/core/web";

import { t } from "../i18n";

export function categoryName(category: Category): string {
  return t(`act_cat_${category}`);
}

export function categoryTagText(category: Category): string {
  return t(`act_tag_${category}`);
}

export function confidenceText(confidence: number): string {
  return t("act_confidence", { value: Math.round(confidence * 100) });
}

export function feedbackToast(kind: "right" | "pick", result: FeedbackResult, trueCategory: Category): string {
  if (!result.saved) return t("act_toast_same");
  if (kind === "right") return t("act_toast_right", { category: categoryName(trueCategory) });
  return t("act_toast_picked", { category: categoryName(trueCategory), ai: categoryName(result.aiCategory) });
}

export function undoToast(kind: UndoWebResult["kind"]): string {
  return t(`undo_${kind}`);
}

export function feedbackStateText(feedback: ActivityItem["feedback"]): string {
  if (feedback === null) return t("act_fb_none");
  if (feedback.trueCategory === null) {
    if (feedback.verdict === "right") return t("act_fb_right");
    return feedback.source === "undo" ? t("act_fb_undo") : t("act_fb_wrong");
  }
  if (feedback.verdict === "right") return t("act_fb_right");
  return t("act_fb_label", { category: categoryName(feedback.trueCategory) });
}

export function senderText(from: string | null): string {
  return from === null || from.trim() === "" ? t("act_unknown_sender") : from;
}

export function subjectText(subject: string | null): string {
  return subject === null || subject.trim() === "" ? t("act_no_subject") : subject;
}

export function delegationText(delegation: NonNullable<ActivityItem["delegation"]>): string {
  return t("act_dlg_line", {
    name: delegation.delegateName ?? t("act_dlg_someone"),
    status: t(`act_dlg_${delegation.status}`),
  });
}
