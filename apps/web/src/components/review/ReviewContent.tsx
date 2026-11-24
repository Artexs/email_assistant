import { formatClock, type PanelReviewItem, type PanelReviewSample, type ReviewLabelCategory } from "@ea/core/web";
import { useState } from "react";

import { getLocale, t } from "../../i18n";
import { categoryName, categoryTagText, senderText, subjectText } from "../../lib/activity-text";
import { canConfirm, pickCategories, reviewFinished } from "../../lib/review-view";
import { Button } from "../ui/button";

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

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50";

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
function ReviewItemCard({ item, sample, answer, locked, busy, timeZone, now, onRight, onPick }: ItemProps) {
  const [picked, setPicked] = useState("");
  const subjectId = `rv-subject-${item.emailId}`;
  const selectId = `rv-pick-${item.emailId}`;
  const categories = pickCategories(sample, item);
  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-lg border p-4"
      data-review-item={item.emailId}
      aria-labelledby={subjectId}
    >
      <p className="truncate text-sm text-muted-foreground">
        {formatClock(new Date(item.receivedAt), timeZone, now, getLocale())} · {senderText(item.fromName)}
      </p>
      <p id={subjectId} className="font-medium break-words">
        {subjectText(item.subject)}
      </p>
      <p className="text-sm" data-review="category">
        {categoryTagText(item.category)} · {t("rv_sure", { value: Math.round(item.confidence * 100) })}
      </p>
      {item.aiText !== null && item.aiText !== "" && (
        <p className="text-sm text-muted-foreground break-words">{item.aiText}</p>
      )}
      {answer !== undefined && (
        <p role="status" className="text-sm font-medium" data-review="answer">
          {answer}
        </p>
      )}
      {answer === undefined && !locked && (
        <div className="flex flex-wrap items-end gap-3">
          {canConfirm(item) && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              aria-describedby={subjectId}
              onClick={() => onRight(item)}
            >
              {t("rv_right")}
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={selectId} className="text-sm">
              {t("rv_pick_label")}
            </label>
            <div className="flex items-center gap-2">
              <select
                id={selectId}
                className={selectClass}
                value={picked}
                disabled={busy}
                onChange={(event) => setPicked(event.target.value)}
              >
                <option value="">{t("rv_pick_none")}</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {categoryName(category)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={busy || picked === ""}
                aria-describedby={subjectId}
                onClick={() => onPick(item, picked as ReviewLabelCategory)}
              >
                {t("save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

// The sample of one mailbox with its buttons. Never a required step: the page has a "Done" button and the thank-you, no badge and no gate.
export function ReviewContent(props: ReviewContentProps) {
  const { sample, answers, busy, doneTapped, timeZone, now, backHref } = props;
  const total = sample.items.length;
  const answered = sample.items.filter((item) => answers[item.emailId] !== undefined).length;
  const finished = reviewFinished(total, answered, doneTapped);
  return (
    <div className="flex flex-col gap-4" data-review-state={total === 0 ? "empty" : finished ? "finished" : "open"}>
      <p>{t("rv_intro")}</p>
      {total === 0 && <p data-review="empty">{t("rv_empty")}</p>}
      {total > 0 && (
        <>
          <p className="text-sm text-muted-foreground" data-review="progress">
            {t("rv_progress", { answered, total })}
          </p>
          <ul className="flex flex-col gap-4">
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
      {(finished || total === 0) && (
        <div className="flex flex-col items-start gap-3">
          {finished && (
            <p role="status" data-review="thanks">
              {t("rv_thanks")}
            </p>
          )}
          <Button asChild variant="outline">
            <a href={backHref}>{t("rv_back")}</a>
          </Button>
        </div>
      )}
    </div>
  );
}
