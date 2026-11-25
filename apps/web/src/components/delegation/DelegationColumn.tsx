import type { DelegationItem } from "@ea/core/web";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { t } from "../../i18n";
import { Button } from "../ui/button";

export interface ColumnHint {
  text: string;
  error: boolean;
}

export interface DelegationColumnProps {
  // The id of the heading; the list is named by it.
  headingId: string;
  title: string;
  icon: LucideIcon;
  // A whole class name that colours the heading.
  tone: string;
  // The line of a column with no rows whose list has ended.
  empty: string;
  items: readonly DelegationItem[];
  // The cursor of the list that holds this column: set while more pages exist.
  next: string | null;
  // The list failed before it gave a row: the column shows Retry instead of its rows.
  failed: boolean;
  loadingMore: boolean;
  hint: ColumnHint | null;
  renderRow(item: DelegationItem): ReactNode;
  onMore(): void;
  onRetry(): void;
}

// One status group of the delegations page: a muted block with a heading (icon, title, the count of the loaded rows, `N+` while more
// pages exist), the cards in a list that the heading names, and "Show more" while the list has a cursor.
export function DelegationColumn({
  headingId,
  title,
  icon: Icon,
  tone,
  empty,
  items,
  next,
  failed,
  loadingMore,
  hint,
  renderRow,
  onMore,
  onRetry,
}: DelegationColumnProps) {
  let body: ReactNode;
  if (failed) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">{t("dgn_load_error")}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  } else if (items.length === 0 && next === null) {
    body = <p className="px-1.5 text-sm text-muted-foreground">{empty}</p>;
  } else {
    body = (
      <>
        {items.length > 0 && (
          <ul aria-labelledby={headingId} className="flex flex-col gap-3">
            {items.map(renderRow)}
          </ul>
        )}
        {next !== null && (
          // `aria-disabled`, not `disabled`: the button keeps the focus while a page loads, and a press then does nothing.
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={loadingMore ? true : undefined}
            className="aria-disabled:cursor-wait aria-disabled:opacity-60"
            onClick={loadingMore ? undefined : onMore}
          >
            {t("dgn_more")}
          </Button>
        )}
      </>
    );
  }
  return (
    <div data-slot="delegation-column" className="flex min-w-0 flex-col gap-3 rounded-xl bg-muted p-3.5">
      <div className="flex items-center gap-2 px-1.5">
        <Icon aria-hidden="true" className={cn("size-4.5 shrink-0", tone)} />
        <h2 id={headingId} className={cn("text-base font-bold", tone)}>
          {title}
        </h2>
        {!failed && (
          <span className="ml-auto rounded-full bg-card px-2.5 text-xs font-bold text-foreground">
            {next === null ? items.length : `${items.length}+`}
          </span>
        )}
      </div>
      {body}
      {/* Always in the page, so a screen reader announces the text when it appears. */}
      <p
        aria-live="polite"
        className={cn(
          "px-1.5 text-sm empty:hidden",
          hint?.error === true ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {hint?.text}
      </p>
    </div>
  );
}
