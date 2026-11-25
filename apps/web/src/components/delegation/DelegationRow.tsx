import type { DelegationItem } from "@ea/core/web";
import { Users } from "lucide-react";
import type { ComponentType } from "react";

import { dateLocale, t } from "../../i18n";
import {
  approvalLink,
  DELEGATION_REMINDER_LIMIT,
  delegationActions,
  dueText,
  REMIND_BLOCK_TEXTS,
  remindBlock,
  STATUS_LABELS,
  type DelegationAction,
  type RemindBlock,
} from "../../lib/delegations-view";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

// The ids that the page uses to give the focus back to a control of a row.
export const ROW_ID_PREFIX = "delegation-row-";
export const rowId = (id: string): string => `${ROW_ID_PREFIX}${id}`;
export const cancelButtonId = (id: string): string => `delegation-cancel-${id}`;
const reasonId = (id: string): string => `delegation-remind-reason-${id}`;

export interface DelegationRowProps {
  item: DelegationItem;
  owner: boolean;
  // The organization is not suspended: no button shows when it is.
  canWrite: boolean;
  timeZone: string;
  // The reason that the last answer of the server gave for Remind now (`drafts_off` is known only from the server).
  blocked: RemindBlock | undefined;
  // The status badge shows only in the closed list: in a column the heading already names the status.
  showStatus?: boolean;
  onAction(item: DelegationItem, action: DelegationAction): void;
}

// A retention-cleared task shows a dash for the eye and a sentence for a screen reader.
function Task({ task }: { task: string | null }) {
  if (task !== null) return <p className="font-bold break-words">{task}</p>;
  return (
    <p className="font-bold">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t("dgn_task_removed")}</span>
    </p>
  );
}

function Actions({ item, owner, canWrite, blocked, onAction }: DelegationRowProps) {
  const actions = delegationActions(item.status, { owner, canWrite });
  if (actions.length === 0) return null;
  const name = item.delegate.name;
  const block = remindBlock(item) ?? blocked ?? null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.includes("remind") && (
          // `aria-disabled`, not `disabled`: the button stays in the tab order, so a keyboard user reaches the reason text.
          <Button
            type="button"
            variant="soft"
            size="sm"
            aria-label={t("dgn_remind_for", { name })}
            aria-disabled={block !== null ? true : undefined}
            aria-describedby={block !== null ? reasonId(item.id) : undefined}
            className="w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            onClick={() => {
              if (block === null) onAction(item, "remind");
            }}
          >
            {t("dgn_remind")}
          </Button>
        )}
        {actions.includes("done") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("dgn_done_for", { name })}
            onClick={() => onAction(item, "done")}
          >
            {t("dgn_done")}
          </Button>
        )}
        {actions.includes("cancel") && (
          <Button
            id={cancelButtonId(item.id)}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("dgn_cancel_for", { name })}
            onClick={() => onAction(item, "cancel")}
          >
            {t("dgn_cancel")}
          </Button>
        )}
      </div>
      {actions.includes("remind") && block !== null && (
        <p id={reasonId(item.id)} className="text-sm text-muted-foreground">
          {block === "limit_reached"
            ? t(REMIND_BLOCK_TEXTS[block], { max: DELEGATION_REMINDER_LIMIT })
            : t(REMIND_BLOCK_TEXTS[block])}
        </p>
      )}
    </div>
  );
}

// One delegation as a card: the task, the subject, the delegate, the due date and what the user can do. The `li` takes the focus after
// "Show more" and after a reload that moved it to another column (`tabIndex` -1: reachable by the page, not a tab stop).
export function DelegationRow(props: DelegationRowProps) {
  const { item, timeZone, showStatus = false } = props;
  const { delegate } = item;
  return (
    <li
      id={rowId(item.id)}
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-lg bg-card p-4 shadow-card outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <div className="flex flex-col gap-1">
        {(showStatus || !delegate.active) && (
          <div className="flex flex-wrap items-center gap-2">
            {showStatus && <Badge variant="secondary">{t(STATUS_LABELS[item.status])}</Badge>}
            {!delegate.active && <Badge variant="outline">{t("dlg_state_off")}</Badge>}
          </div>
        )}
        <Task task={item.task} />
        <p className="text-sm break-words text-muted-foreground">
          {`${t("dgn_subject")}: ${item.subject ?? t("dgn_no_subject")}`}
        </p>
      </div>
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <Users aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          <span className="block font-bold break-words text-foreground">{delegate.name}</span>
          <span className="block break-all">{delegate.email}</span>
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        {item.dueAt === null ? t("dgn_no_due") : t("dgn_due", { date: dueText(item.dueAt, timeZone, dateLocale()) })}
        {" · "}
        {t("dgn_reminders", { n: item.remindersSent, max: DELEGATION_REMINDER_LIMIT })}
      </p>
      {item.reminderWaiting && (
        <p className="text-sm">
          {`${t("dgn_reminder_waits")} `}
          <a href="/approvals" className="underline">
            {t("dgn_open_approvals")}
          </a>
        </p>
      )}
      {item.status === "drafted" && item.sendId !== null && (
        <p className="text-sm">
          <a href={approvalLink(item.sendId)} className="underline">
            {t("dgn_open_draft")}
          </a>
        </p>
      )}
      <Actions {...props} />
    </li>
  );
}

export type DelegationRowComponent = ComponentType<DelegationRowProps>;
