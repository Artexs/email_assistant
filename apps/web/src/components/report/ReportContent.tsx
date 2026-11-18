import type { BarCategory, TrustView } from "@ea/core/web";

import { t, type TextKey } from "../../i18n";
import {
  dueCategories,
  PANEL_REVIEW_HREF,
  recommendationNote,
  REPORT_CATEGORIES,
  REPORT_SAMPLE_MAX,
  reportState,
  showCategories,
  showCheckAgain,
  showTurnOn,
} from "../../lib/report-view";
import { trustLines, type TrustTone } from "../../lib/trust-card";
import { Button } from "../ui/button";

export interface TurnedOn {
  categories: readonly BarCategory[];
  mode: TrustView["mode"];
}

export interface ReportContentProps {
  view: TrustView;
  isOwner: boolean;
  pending: boolean;
  // The answer of the last tap on "Turn on recommended" (null: none yet).
  turnedOn: TurnedOn | null;
  onTurnOn(): void;
  onCheckAgain(): void;
}

const toneClass: Record<TrustTone, string> = {
  ok: "text-sm",
  warn: "text-sm text-muted-foreground",
  muted: "text-sm text-muted-foreground",
  bad: "text-sm text-destructive",
};

const categoryNames = (categories: readonly BarCategory[]): string =>
  categories.map((category) => t(`cat_${category}`)).join(", ");

// The report of one mailbox: counts and fixed phrases only. The view holds example mails for the panel review; this component never reads
// `view.examples`, so no sender name, subject or address can show here (F110 stage 14).
export function ReportContent({ view, isOwner, pending, turnedOn, onTurnOn, onCheckAgain }: ReportContentProps) {
  const state = reportState(view);
  const due = dueCategories(view);
  const note = recommendationNote(view);

  return (
    <div className="flex flex-col gap-4" data-report-state={state.kind}>
      <p>{t("rep_intro")}</p>
      {state.kind === "starting" && (
        <p aria-live="polite" data-report="starting">
          {t("rep_starting")}
        </p>
      )}
      {state.kind === "running" && (
        <p aria-live="polite" data-report="progress">
          {t("rep_progress", { checked: state.checked, max: REPORT_SAMPLE_MAX })}
        </p>
      )}
      {state.kind === "no_result" && <p data-report="no-result">{t(state.reasonKey)}</p>}
      {state.kind === "done" && view.check !== null && (
        <p data-report="summary">
          {t("rep_checked", { checked: view.check.checked })}
          {state.capped ? ` ${t("rep_capped")}` : ""}
        </p>
      )}
      {showCategories(view) && (
        <ul className="flex flex-col gap-4">
          {REPORT_CATEGORIES.map((category) => {
            const row = view.categories[category];
            const lines = trustLines(category, view);
            const isDue = due.includes(category);
            const status: TextKey = row.auto ? "rep_auto_on" : isDue ? "rep_recommended" : "rep_not_recommended";
            return (
              <li key={category} className="flex flex-col gap-1 rounded-lg border p-4" data-category={category}>
                <h2 className="font-medium">{t(`cat_${category}`)}</h2>
                {row.history !== null && (
                  <p className="text-sm">
                    {t("rep_counts", { total: row.history.total, wouldMove: row.history.wouldMove })}
                  </p>
                )}
                {lines.map((line) => (
                  <p key={line.key} data-line={line.key} className={toneClass[line.tone]}>
                    {t(line.key, line.vars)}
                  </p>
                ))}
                <p className="text-sm font-medium" data-status={status}>
                  {t(status)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {showCategories(view) && note === "none" && (
        <p className="text-sm text-muted-foreground" data-report="nothing">
          {t("rep_nothing")}
        </p>
      )}
      {showCategories(view) && note === "all_on" && (
        <p className="text-sm text-muted-foreground" data-report="all-on">
          {t("rep_all_on")}
        </p>
      )}
      {turnedOn !== null && (
        <p role="status" data-report="turned-on">
          {t("rep_turned_on", { categories: categoryNames(turnedOn.categories) })} {t(`rep_mode_${turnedOn.mode}`)}
        </p>
      )}
      {showTurnOn(view, isOwner) && (
        <Button className="self-start" disabled={pending} onClick={onTurnOn}>
          {t("rep_turn_on", { categories: categoryNames(due) })}
        </Button>
      )}
      {!isOwner && showCategories(view) && due.length > 0 && (
        <p className="text-sm text-muted-foreground">{t("rep_owner_only")}</p>
      )}
      {showCategories(view) && PANEL_REVIEW_HREF !== null && (
        <p className="text-sm">
          {t("rep_review_suggest")}{" "}
          <a className="underline" href={PANEL_REVIEW_HREF}>
            {t("rep_review_link")}
          </a>
        </p>
      )}
      {showCheckAgain(view, isOwner) && (
        <Button className="self-start" variant="outline" disabled={pending} onClick={onCheckAgain}>
          {t("rep_check_again")}
        </Button>
      )}
      <p className="text-sm text-muted-foreground">{t("rep_read_only")}</p>
    </div>
  );
}
