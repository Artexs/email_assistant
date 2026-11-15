import type { ApprovalItem } from "@ea/core/web";
import type { MouseEvent } from "react";

import { t } from "../../i18n";
import { cn } from "cn";
import { ApprovalSummary } from "./ApprovalSummary";

export interface ApprovalListProps {
  items: readonly ApprovalItem[];
  selectedId: string | null;
  now: Date;
  onSelect(id: string): void;
}

// A plain click selects without a page load; a click with a modifier key or a middle click keeps the link's own behaviour.
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function approvalHref(id: string): string {
  return `/approvals?id=${encodeURIComponent(id)}`;
}

export function ApprovalList({ items, selectedId, now, onSelect }: ApprovalListProps) {
  return (
    <ul aria-label={t("appr_list_label")} className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={approvalHref(item.id)}
            aria-current={item.id === selectedId ? "true" : undefined}
            onClick={(event) => {
              if (!isPlainClick(event)) return;
              event.preventDefault();
              onSelect(item.id);
            }}
            className={cn(
              "block rounded-md border p-3 hover:border-foreground",
              item.id === selectedId && "border-2 border-foreground"
            )}
          >
            <ApprovalSummary item={item} now={now} />
          </a>
        </li>
      ))}
    </ul>
  );
}
