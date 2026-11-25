import type { ActivityItem, Category, FeedbackResult, SenderLine, UndoWebResult } from "@ea/core/web";

import { t } from "../i18n";

export function categoryName(category: Category): string {
  return t(`act_cat_${category}`);
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

// The sender rule that shaped a result, as a short phrase ("VIP sender"). The pattern of the rule is never known here.
export function ruleName(rule: NonNullable<ActivityItem["rule"]>): string {
  return t(`act_rule_${rule}`);
}

export function ruleLine(rule: NonNullable<ActivityItem["rule"]>): string {
  return t(`act_rule_hit_${rule}`);
}

// The sender line under the From line, in Activity and in Approvals: the relation, then the parts that have a number to show,
// joined by " · ". The answered part shows when the sender sent mail at all (also with 0 answered), the wrote part when the user wrote to them,
// the last-mail part when the date is known (0 days reads "today").
export function senderLineText(line: SenderLine): string {
  const parts = [t(`sender_rel_${line.relation}`)];
  if (line.received > 0) {
    parts.push(t("sender_answered", { answered: line.answered, received: line.received, days: line.days }));
  }
  if (line.userMailsTo > 0) parts.push(t("sender_wrote", { userMailsTo: line.userMailsTo }));
  if (line.lastSeenDaysAgo !== null) {
    parts.push(
      line.lastSeenDaysAgo === 0 ? t("sender_last_seen_today") : t("sender_last_seen", { n: line.lastSeenDaysAgo })
    );
  }
  return parts.join(" · ");
}
