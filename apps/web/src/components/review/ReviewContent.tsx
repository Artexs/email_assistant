import { formatClock, type PanelReviewItem, type PanelReviewSample, type ReviewLabelCategory } from "@ea/core/web";
import { Check, ChevronDown, ClipboardCheck, PartyPopper } from "lucide-react";

import { getLocale, t } from "../../i18n";
import { categoryName, senderText, subjectText } from "../../lib/activity-text";
import { canConfirm, pickCategories, reviewFinished } from "../../lib/review-view";
import { CategoryPill } from "../patterns/CategoryPill";
import { EmptyState } from "../patterns/EmptyState";
import { ProgressRing } from "../patterns/ProgressRing";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export interface ReviewContentProps {
  sample: PanelReviewSample;
  // The text of the saved answer per mail id (this page load only). A mail with an entry has been answered.
  answers: Readonly<Record<string, string>>;
  // A write is in flight, or the organization is paused: the buttons are off.
  busy: boolean;
  doneTapped: boolean;
  timeZone: string;
  now: Date;
  backHref: string;
  onRight(item: PanelReviewItem): void;
  onPick(item: PanelReviewItem, category: ReviewLabelCategory): void;
  onDone(): void;
}

interface ItemProps {
  item: PanelReviewItem;
  sample: PanelReviewSample;
  answer: string | undefined;
  locked: boolean;
  busy: boolean;
  timeZone: string;
  now: Date;
  onRight(item: PanelReviewItem): void;
  onPick(item: PanelReviewItem, category: ReviewLabelCategory): void;
}

// One decision. The sender name, the subject and the AI text are mail text: React prints them as plain text.
// A pick in the menu saves at once; the card then shows its answer and locks.
function ReviewItemCard({ item, sample, answer, locked, busy, timeZone, now, onRight, onPick }: ItemProps) {
  const subjectId = `rv-subject-${item.emailId}`;
  const categories = pickCategories(sample, item);
  const answered = answer !== undefined;
  return (
    <li className="flex min-w-0" data-review-item={item.emailId} aria-labelledby={subjectId}>
      <Card className={answered ? "w-full gap-3 bg-primary-soft py-5" : "w-full gap-3 py-5"}>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-review="category">
            <CategoryPill category={item.category} label={categoryName(item.category)} />
            <span className="text-sm text-muted-foreground">
              {t("rv_sure", { value: Math.round(item.confidence * 100) })}
            </span>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {formatClock(new Date(item.receivedAt), timeZone, now, getLocale())} · {senderText(item.fromName)}
          </p>
          <p id={subjectId} className="text-lg font-bold break-words">
            {subjectText(item.subject)}
          </p>
          {item.aiText !== null && item.aiText !== "" && (
            <p className="text-sm text-muted-foreground break-words">{item.aiText}</p>
          )}
          {answered && (
            <p role="status" className="text-sm font-bold" data-review="answer">
              {answer}
            </p>
          )}
          {!answered && !locked && (
            <div className="flex flex-wrap gap-2.5">
              {canConfirm(item) && (
                <Button type="button" disabled={busy} aria-describedby={subjectId} onClick={() => onRight(item)}>
                  <Check aria-hidden="true" />
                  {t("rv_right")}
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    aria-label={t("rv_pick_label")}
                    aria-describedby={subjectId}
                  >
                    {t("rv_other")}
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {categories.map((category) => (
                    <DropdownMenuItem key={category} onSelect={() => onPick(item, category)}>
                      <CategoryPill category={category} label={categoryName(category)} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

// The sample of one mailbox with its buttons. Never a required step: the page has a "Done" button and the thank-you, no badge and no gate.
export function ReviewContent(props: ReviewContentProps) {
  const { sample, answers, busy, doneTapped, timeZone, now, backHref } = props;
  const total = sample.items.length;
  const answered = sample.items.filter((item) => answers[item.emailId] !== undefined).length;
  const finished = reviewFinished(total, answered, doneTapped);
  const back = (
    <Button asChild>
      <a href={backHref}>{t("rv_back")}</a>
    </Button>
  );
  return (
    <div className="flex flex-col gap-4" data-review-state={total === 0 ? "empty" : finished ? "finished" : "open"}>
      {total === 0 && (
        <div data-review="empty">
          <EmptyState icon={ClipboardCheck} title={t("rv_empty")}>
            {back}
          </EmptyState>
        </div>
      )}
      {total > 0 && (
        <>
          <div className="flex items-center gap-3">
            <ProgressRing value={answered} max={total} label={t("rv_progress", { answered, total })}>
              {answered}
            </ProgressRing>
            <p className="text-base font-bold" data-review="progress">
              {t("rv_progress", { answered, total })}
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {sample.items.map((item) => (
              <ReviewItemCard
                key={item.emailId}
                item={item}
                sample={sample}
                answer={answers[item.emailId]}
                locked={finished}
                busy={busy}
                timeZone={timeZone}
                now={now}
                onRight={props.onRight}
                onPick={props.onPick}
              />
            ))}
          </ul>
        </>
      )}
      {total > 0 && !finished && (
        <Button className="self-start" variant="outline" onClick={props.onDone}>
          {t("rv_done")}
        </Button>
      )}
      {finished && (
        <div role="status" data-review="thanks">
          <EmptyState icon={PartyPopper} title={t("rv_thanks_title")} text={t("rv_thanks")}>
            {back}
          </EmptyState>
        </div>
      )}
    </div>
  );
}
