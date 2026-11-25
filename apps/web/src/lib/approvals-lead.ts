import { APPROVAL_LIST_MAX, type ApprovalItem } from "@ea/core/web";

import { t, tp } from "../i18n";

// The line under the page title: how many drafts wait for a decision. Held sends are approved already and do not count. The list holds
// at most `APPROVAL_LIST_MAX` sends, so a full list says "or more".
export function approvalsLeadText(items: readonly Pick<ApprovalItem, "state">[]): string {
  if (items.length >= APPROVAL_LIST_MAX) return t("appr_lead_cap", { n: APPROVAL_LIST_MAX });
  const waiting = items.filter((item) => item.state === "waiting").length;
  return waiting === 0 ? t("appr_none") : tp("appr_lead", waiting);
}
