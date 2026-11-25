import type { BarCategory, TrustView } from "@ea/core/web";
import { cn } from "cn";

import { t } from "../../i18n";
import {
  dueCategories,
  recommendationNote,
  REPORT_CATEGORIES,
  REPORT_SAMPLE_MAX,
  reportState,
  showCategories,
  showCheckAgain,
  showTurnOn,
} from "../../lib/report-view";
import { trustLines, type TrustTone } from "../../lib/trust-card";
import { CategoryPill } from "../patterns/CategoryPill";
import { FactBox } from "../patterns/FactBox";
import { ProgressRing } from "../patterns/ProgressRing";
import { Badge } from "../ui/badge";
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
  // The path of the optional panel review; null while the flag `panel_review` is off: no link then.
  reviewHref: string | null;
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

type StatusKey = "rep_auto_on" | "rep_recommended" | "rep_not_recommended";

const statusBadge: Record<StatusKey, "default" | "secondary"> = {
  rep_auto_on: "default",
  rep_recommended: "default",
  rep_not_recommended: "secondary",
};

// The report of one mailbox: counts and fixed phrases only. The view holds example mails for the panel review; this component never reads
// `view.examples`, so no sender name, subject or address can show here.
export function ReportContent({
  view,
  isOwner,
  pending,
  turnedOn,
  reviewHref,
  onTurnOn,
  onCheckAgain,
}: ReportContentProps) {
  const state = reportState(view);
  const due = dueCategories(view);
  const note = recommendationNote(view);
  const turnOnShows = showTurnOn(view, isOwner);
  const checkAgainShows = showCheckAgain(view, isOwner);
  const ownerOnlyShows = !isOwner && showCategories(view) && due.length > 0;
  const reviewShows = showCategories(view) && reviewHref !== null;
  const actionCard = turnedOn !== null || turnOnShows || ownerOnlyShows || reviewShows || checkAgainShows;

  return (
    <div className="flex flex-col gap-4" data-report-state={state.kind}>
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
      {/* No checked mail of the user's own: no "0" beside the counts of the cards. */}
      {state.kind === "done" && view.check !== null && view.check.checked > 0 && (
        <p data-report="summary">
          {t("rep_checked", { checked: view.check.checked })}
          {state.capped ? ` ${t("rep_capped")}` : ""}
        </p>
      )}
      {showCategories(view) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {REPORT_CATEGORIES.map((category) => {
            const row = view.categories[category];
            const lines = trustLines(category, view);
            const isDue = due.includes(category);
            const status: StatusKey = row.auto ? "rep_auto_on" : isDue ? "rep_recommended" : "rep_not_recommended";
            const counts =
              row.history === null
                ? null
                : t("rep_counts", { total: row.history.total, wouldMove: row.history.wouldMove });
            return (
              <article
                key={category}
                className={cn(
                  "flex flex-col gap-3 rounded-lg bg-card p-5 text-card-foreground shadow-(--shadow-card) forced-colors:border",
                  isDue && "outline-2 -outline-offset-2 outline-primary"
                )}
                data-category={category}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CategoryPill category={category} label={t(`cat_${category}`)} />
                  <Badge variant={statusBadge[status]} data-status={status}>
                    {t(status)}
                  </Badge>
                </div>
                {row.history !== null && counts !== null && (
                  <div className="flex items-center gap-3">
                    <ProgressRing value={row.history.wouldMove} max={row.history.total} label={counts}>
                      {row.history.wouldMove}
                    </ProgressRing>
                    <p className="text-sm">{counts}</p>
                  </div>
                )}
                {lines.map((line) => (
                  <p key={line.key} data-line={line.key} className={toneClass[line.tone]}>
                    {t(line.key, line.vars)}
                  </p>
                ))}
              </article>
            );
          })}
        </div>
      )}
      {showCategories(view) && note === "none" && (
        <FactBox>
          <p data-report="nothing">{t("rep_nothing")}</p>
        </FactBox>
      )}
      {/* Right after a tap that turned categories on, the card below says what changed; the warm note is for a plain visit. */}
      {showCategories(view) && note === "all_on" && turnedOn === null && (
        <FactBox>
          <p data-report="all-on">{t("rep_all_on")}</p>
        </FactBox>
      )}
      {actionCard && (
        <section
          aria-labelledby="report-next-title"
          className="flex flex-col gap-4 rounded-lg bg-card p-5 text-card-foreground shadow-(--shadow-card) forced-colors:border lg:flex-row lg:items-center"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2 id="report-next-title" className="text-lg font-bold">
              {t(turnOnShows ? "rep_turn_on_title" : "rep_next_title")}
            </h2>
            {turnedOn !== null && (
              <p role="status" data-report="turned-on">
                {t("rep_turned_on", { categories: categoryNames(turnedOn.categories) })}{" "}
                {t(`rep_mode_${turnedOn.mode}`)}
              </p>
            )}
            {ownerOnlyShows && <p className="text-sm text-muted-foreground">{t("rep_owner_only")}</p>}
            {reviewShows && (
              <p className="text-sm text-muted-foreground">
                {t("rep_review_suggest")}{" "}
                <a className="text-primary underline" href={reviewHref}>
                  {t("rep_review_link")}
                </a>
              </p>
            )}
          </div>
          {(turnOnShows || checkAgainShows) && (
            <div className="flex flex-wrap items-center gap-3">
              {turnOnShows && (
                <Button className="h-auto min-h-12 max-w-full py-2 text-wrap" disabled={pending} onClick={onTurnOn}>
                  {t("rep_turn_on", { categories: categoryNames(due) })}
                </Button>
              )}
              {checkAgainShows && (
                <Button variant="soft" disabled={pending} onClick={onCheckAgain}>
                  {t("rep_check_again")}
                </Button>
              )}
            </div>
          )}
        </section>
      )}
      <p className="text-sm text-muted-foreground">{t("rep_read_only")}</p>
    </div>
  );
}
