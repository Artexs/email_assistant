import type { ApprovalItem } from "@ea/core/web";
import type { MouseEvent } from "react";

import { t } from "../../i18n";
import { cn } from "cn";
import { InitialsAvatar } from "../patterns/InitialsAvatar";
import { ApprovalTitle, recipientName, stateLineText } from "./ApprovalSummary";

export interface WaitingListProps {
  items: readonly ApprovalItem[];
  // The draft that the card shows now.
  focusId: string | null;
  now: Date;
  onPick(id: string): void;
}

// A plain click picks without a page load; a click with a modifier key or a middle click keeps the link's own behaviour.
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function approvalHref(id: string): string {
  return `/approvals?id=${encodeURIComponent(id)}`;
}

function Rows({ items, focusId, now, onPick }: WaitingListProps) {
  return (
    <>
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={approvalHref(item.id)}
            aria-current={item.id === focusId ? "true" : undefined}
            onClick={(event) => {
              if (!isPlainClick(event)) return;
              event.preventDefault();
              onPick(item.id);
            }}
            className={cn(
              "flex items-center gap-3 rounded-md p-3 hover:bg-muted focus-visible:outline-3 focus-visible:outline-ring",
              item.id === focusId && "bg-primary-soft"
            )}
          >
            <InitialsAvatar name={recipientName(item.view)} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="break-words text-sm font-bold">
                <ApprovalTitle view={item.view} />
              </span>
              <span className="break-words text-sm">{item.view.subject}</span>
              <span className="text-xs text-muted-foreground">{stateLineText(item, now)}</span>
            </span>
          </a>
        </li>
      ))}
    </>
  );
}

// The drafts that wait for a decision, then the approved sends that the server still holds. Every row links to its own draft.
export function WaitingList({ items, focusId, now, onPick }: WaitingListProps) {
  const waiting = items.filter((item) => item.state !== "held");
  const held = items.filter((item) => item.state === "held");
  const rows = { focusId, now, onPick };
  return (
    <ul aria-label={t("appr_list_label")} className="flex flex-col gap-1">
      <Rows items={waiting} {...rows} />
      {held.length > 0 && (
        <li>
          <h3 className="px-3 pt-3 text-sm font-bold text-muted-foreground">{t("appr_held_heading")}</h3>
        </li>
      )}
      <Rows items={held} {...rows} />
    </ul>
  );
}
