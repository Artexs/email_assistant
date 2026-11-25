import type { LoopItem } from "@ea/core/web";
import type { ComponentType } from "react";

import { dateLocale, t, type TextKey } from "../../i18n";
import { approvalLink, dueText } from "../../lib/delegations-view";
import {
  followUpBlocked,
  LOOP_FOLLOW_UP_MAX,
  loopActions,
  loopName,
  reasonText,
  type LoopAction,
} from "../../lib/loops-view";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

// The ids that the page uses to give the focus back to a control of a row.
export const LOOP_ROW_ID_PREFIX = "loop-row-";
export const loopRowId = (id: string): string => `${LOOP_ROW_ID_PREFIX}${id}`;
export const loopButtonId = (id: string, action: LoopAction): string => `loop-${action}-${id}`;
const reasonId = (id: string): string => `loop-follow-up-reason-${id}`;
const DUE_KEY: Record<LoopItem["dueSource"], TextKey> = {
  stated: "lp_due_stated",
  default: "lp_due_default",
  contact: "lp_due_contact",
};

export interface LoopRowProps {
  item: LoopItem;
  owner: boolean;
  // The organization is not suspended: no button shows when it is.
  canWrite: boolean;
  timeZone: string;
  // The time of the render: the reason line counts the working days up to it.
  now: Date;
  onAction(item: LoopItem, action: LoopAction): void;
}

// The retention clears the text of a loop; the subject goes with it after 90 days. A dash for the eye and a sentence for a screen reader.
function LoopText({ item }: { item: LoopItem }) {
  const text = item.text ?? item.subject;
  if (text !== null) return <p className="break-words">{text}</p>;
  return (
    <p>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t("lp_no_text")}</span>
    </p>
  );
}

const BUTTON_TEXTS: Record<LoopAction, { text: TextKey; label: TextKey }> = {
  follow_up: { text: "lp_follow_up", label: "lp_follow_up_for" },
  later: { text: "lp_later", label: "lp_later_for" },
  done: { text: "lp_done", label: "lp_done_for" },
  drop: { text: "lp_drop", label: "lp_drop_for" },
  untrack: { text: "lp_untrack", label: "lp_untrack_for" },
  reopen: { text: "lp_reopen", label: "lp_reopen_for" },
};

// Draft follow-up is the main step of a loop; Later, Done and Reopen are plain; Drop and Stop tracking are quiet.
const BUTTON_VARIANTS: Record<LoopAction, "soft" | "outline" | "ghost"> = {
  follow_up: "soft",
  later: "outline",
  done: "outline",
  drop: "ghost",
  untrack: "ghost",
  reopen: "outline",
};

function Actions({ item, owner, canWrite, onAction }: LoopRowProps) {
  const actions = loopActions(item, { owner, canWrite });
  const waits = item.status === "open" && item.followUpWaiting && item.kind !== "promised";
  if (actions.length === 0 && !waits) return null;
  const name = loopName(item);
  // `aria-disabled`, not `disabled`: the button stays in the tab order, so a keyboard user reaches the reason text.
  const blocked = actions.includes("follow_up") && followUpBlocked(item);
  return (
    <div className="flex flex-col gap-2">
      {waits && (
        <p className="text-sm">
          {`${t("lp_follow_up_waits")} `}
          {item.sendId !== null && (
            <a href={approvalLink(item.sendId)} className="underline">
              {t("lp_follow_up_link")}
            </a>
          )}
        </p>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const isBlocked = action === "follow_up" && blocked;
            return (
              <Button
                key={action}
                id={loopButtonId(item.id, action)}
                type="button"
                variant={BUTTON_VARIANTS[action]}
                size="sm"
                aria-label={t(BUTTON_TEXTS[action].label, { name })}
                aria-disabled={isBlocked ? true : undefined}
                aria-describedby={isBlocked ? reasonId(item.id) : undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
                onClick={() => {
                  if (!isBlocked) onAction(item, action);
                }}
              >
                {t(BUTTON_TEXTS[action].text)}
              </Button>
            );
          })}
        </div>
      )}
      {blocked && (
        <p id={reasonId(item.id)} className="text-sm text-muted-foreground">
          {t("lp_c_follow_up_limit")}
        </p>
      )}
    </div>
  );
}

interface RowLayout {
  // The first line: who the loop is about.
  heading: string | null;
  // The second line of the heading (the delegate's address).
  subheading: string | null;
  // Waiting and delegated loops count their follow-ups; a promise has none.
  followUps: boolean;
}

function LoopCard(props: LoopRowProps & { layout: RowLayout }) {
  const { item, timeZone, now, layout } = props;
  const due = dueText(item.dueAt, timeZone, dateLocale());
  return (
    <li
      id={loopRowId(item.id)}
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          {layout.heading !== null && <InitialsAvatar name={layout.heading} size="sm" />}
          <div className="flex min-w-0 flex-col gap-0.5">
            {layout.heading === null ? (
              <p aria-hidden="true" className="font-bold">
                —
              </p>
            ) : (
              <p className="font-bold break-words">{layout.heading}</p>
            )}
            {layout.subheading !== null && (
              <p className="text-sm break-all text-muted-foreground">{layout.subheading}</p>
            )}
          </div>
        </div>
        <Badge variant="secondary">{t(item.status === "open" ? "lp_status_open" : "lp_status_closed")}</Badge>
      </div>
      <LoopText item={item} />
      <p className="text-sm break-words text-muted-foreground">{reasonText(item, now, timeZone)}</p>
      <p className="text-sm text-muted-foreground">
        {t(DUE_KEY[item.dueSource], { date: due })}
        {layout.followUps && ` · ${t("lp_follow_ups", { n: item.followUpsSent, max: LOOP_FOLLOW_UP_MAX })}`}
      </p>
      {item.usualReplyDays !== null && (
        <p className="text-sm text-muted-foreground">
          {item.usualReplyDays === 1 ? t("lp_usual_reply_one") : t("lp_usual_reply", { n: item.usualReplyDays })}
        </p>
      )}
      {(item.matchedBySubject || item.autoReplyOnly) && (
        <div className="flex flex-wrap gap-2">
          {item.matchedBySubject && (
            <Badge variant="secondary" className="h-auto whitespace-normal">
              {t("lp_matched_subject")}
            </Badge>
          )}
          {item.autoReplyOnly && (
            <Badge variant="secondary" className="h-auto whitespace-normal">
              {t("lp_auto_reply_only")}
            </Badge>
          )}
        </div>
      )}
      <Actions {...props} />
    </li>
  );
}

// One component per kind of loop; the kinds differ in who the heading names and whether follow-ups count.
export function WaitingRow(props: LoopRowProps) {
  return <LoopCard {...props} layout={{ heading: props.item.counterpart, subheading: null, followUps: true }} />;
}

export function PromisedRow(props: LoopRowProps) {
  return <LoopCard {...props} layout={{ heading: props.item.counterpart, subheading: null, followUps: false }} />;
}

// A hand forward to a delegate: the heading is the delegate, the address under it is where the forward went.
export function DelegatedRow(props: LoopRowProps) {
  const { delegate, counterpart } = props.item;
  return (
    <LoopCard
      {...props}
      layout={{
        heading: delegate?.name ?? counterpart,
        subheading: delegate === null ? null : counterpart,
        followUps: true,
      }}
    />
  );
}

export type LoopRowComponent = ComponentType<LoopRowProps>;
